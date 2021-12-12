import {
  Field,
  PrivateKey,
  PublicKey,
  SmartContract,
  state,
  State,
  method,
  UInt64,
  Mina,
  Party,
  isReady,
  shutdown, Signature, Bool, arrayProp, Circuit,
} from 'snarkyjs';

class BlindMansBluff extends SmartContract {
  // The state of the game: 0 -> initial betting phase, 1 -> game bet phase, 2 -> game end
  @state(Field) gamePhase: State<Field>;
  @state(UInt64) minBet: State<Field>;
  @state(PublicKey) player1: State<PublicKey>;
  @state(PublicKey) player2: State<PublicKey>;
  @state(PublicKey) turn: State<PublicKey>;

  @state(Bool) player1AntePaid: State<Bool>;
  @state(Bool) player2AntePaid: State<Bool>;

  constructor(initialBalance: UInt64, address: PublicKey, player1: PublicKey, player2: PublicKey) {
    super(address);
    this.balance.addInPlace(initialBalance);
    this.gamePhase = State.init(new Field(0));
    this.player1 = State.init(player1);
    this.player2 = State.init(player2);
    this.turn = State.init(player1);
    this.minBet = State.init(new Field(10));

    this.player1AntePaid = State.init(Bool(false));
    this.player2AntePaid = State.init(Bool(false))
  }

  @method
  async payAnte(playerPublicKey: PublicKey, signature: Signature, betAmount: UInt64) {
    // START: same asserting logics for async bet()
    const gamePhase = await this.gamePhase.get();
    gamePhase.assertEquals(new Field(0));
    const minBet = await this.minBet.get(); // diff: ante bet should be all equal
    minBet.equals(betAmount.value).assertEquals(true);
    signature.verify(playerPublicKey, betAmount.toFields()).assertEquals(true);
    const player1 = await this.player1.get();
    const player2 = await this.player2.get();
    Bool.or(playerPublicKey.equals(player1), playerPublicKey.equals(player2)).assertEquals(true);
    // END: same asserting logics for async bet()

    // check if caller is player 1 or player 2
    const isPlayerOne = Circuit.if(playerPublicKey.equals(player1), new Bool(true), new Bool(false));

    const isPlayerOnePaidAnte = await this.player1AntePaid.get();
    const isPlayerTwoPaidAnte = await this.player2AntePaid.get();
    // isPlayerOne     (A)  F | T | T | T | F | F | T | F
    // isPlayerOnePaid (B)  F | F | T | F | T | F | T | T
    // isPlayerTwoPaid (C)  F | F | F | T | F | T | T | T
    // result          (Y)  T | T | F | T | T | F | F | F
    // Y = A'B'C' + AB'C' + AB'C + A'BC'
    //   => or(and(not(a), not(b), not(c)), and(a, not(b), not(c)), and(a, not(b), c), and(not(a), b, not(c))
    // I'm sure there was a way to simplify this..
    // first verify if the game state is good to pay ante for either players
    const isGoodToPayAnte = Bool.or(
      Bool.or(
        Bool.and(
          Bool.and(
            isPlayerOne.not(),
            isPlayerOnePaidAnte.not()
          ),
          isPlayerTwoPaidAnte.not()
        ),
        Bool.and(
          Bool.and(
            isPlayerOne,
            isPlayerOnePaidAnte.not()
          ),
          isPlayerTwoPaidAnte.not()
        ),
      ),
      Bool.or(
        Bool.and(
          Bool.and(
            isPlayerOne,
            isPlayerOnePaidAnte.not()
          ),
          isPlayerTwoPaidAnte
        ),
        Bool.and(
          Bool.and(
            isPlayerOne.not(),
            isPlayerOnePaidAnte
          ),
          isPlayerTwoPaidAnte.not()
        ),
      )
    );
    isGoodToPayAnte.assertEquals(true);

    // isPlayerOne      (A) T | T | F | F
    // isPlayerOnePaid  (B) T | F | T | F
    // result           (Y) F | T | T | F
    // if it is player one's call, check and update, if it's player two's call, just use (B) value
    // Y = AB' + A'B
    //   => or(and(a, not(b)), and(not(a), b))
    this.player1AntePaid.set(Bool.or(
      Bool.and(
        isPlayerOne,
        isPlayerOnePaidAnte.not()
      ),
      Bool.and(
        isPlayerOne.not(),
        isPlayerOnePaidAnte
      )))

    // isPlayerOne      (A) T | T | F | F
    // isPlayerTwoPaid  (C) T | F | T | F
    // result           (Y) T | F | F | T
    // same logic with player one, but inversed
    // Y = AC + A'C'
    //   => or(and(a, c), and(not(a), not(b)))
    this.player2AntePaid.set(Bool.or(
      Bool.and(isPlayerOne, isPlayerTwoPaidAnte),
      Bool.and(isPlayerOne.not(), isPlayerTwoPaidAnte.not())
      ));

    this.balance.addInPlace(betAmount);
  }

  @method
  async bet(playerPublicKey: PublicKey, signature: Signature, betAmount: UInt64) {
    // 1. continue only if the gamephase is in betting phase
    const gamePhase = await this.gamePhase.get();
    gamePhase.assertEquals(new Field(1));

    // 2. continue only if the bet amount is higher than the current min bet
    const minBet = await this.minBet.get();
    minBet.gte(betAmount.value).assertEquals(true);

    // 3. verify that you are the one who signed the betting transaction
    signature.verify(playerPublicKey, betAmount.toFields()).assertEquals(true);

    // 4. check that the player is within the users whitelisted to play this game
    const player1 = await this.player1.get();
    const player2 = await this.player2.get();
    Bool.or(playerPublicKey.equals(player1), playerPublicKey.equals(player2)).assertEquals(true);

    // 5. check if it is my turn to bet
    const myTurn = await this.turn.get();
    myTurn.assertEquals(playerPublicKey);

    // verification is done. lets change the state now
    await this.minBet.set(betAmount.value);



  }
}

export async function run() {
  await isReady;

  // initialize mina local blockchain
  const Local = Mina.LocalBlockchain();
  Mina.setActiveInstance(Local);
  const account1 = Local.testAccounts[0].privateKey;
  const account2 = Local.testAccounts[1].privateKey;
  // const account3 = Local.testAccounts[2].privateKey;
  // const account4 = Local.testAccounts[3].privateKey;

  const snappPrivkey = PrivateKey.random();
  const snappPubkey = snappPrivkey.toPublicKey();

  let game: BlindMansBluff;

  // Deploys the snapp
  await Mina.transaction(account1, async () => {
    // account2 sends 1000000000 to the new snapp account
    const amount = UInt64.fromNumber(1000000000);
    const p = await Party.createSigned(account2);
    p.balance.subInPlace(amount);

    // two players committed to play the blind mans bluff
    game = new BlindMansBluff(amount, snappPubkey, account1.toPublicKey(), account2.toPublicKey());
  })
    .send()
    .wait();

  // game starts, time for ante betting (an initial forced bet for all players before the dealing begins)
  await Mina.transaction(account1, async () => {
    await game.payAnte()
    await snappInstance.update(new Field(27));
  })
    .send()
    .wait();

  const a = await Mina.getAccount(snappPubkey);

  console.log('Exercise 1');
  console.log('final state value', a.snapp.appState[0].toString());
}

run();
shutdown();
