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
  Bool,
  Party,
  isReady,
  shutdown, Signature, Circuit, Poseidon,
} from 'snarkyjs';
import * as readline from 'readline';

enum GameActions {
  PLAYER_TWO_PAY_ANTE = 1,
  CHECK_OPPONENTS_CARD = 2,
  PLAYER_ONE_BET = 3,
}

function getBelowTen(numString: string): number {
  console.log("getBelowTen()", numString);
  let num = Number(numString);
  while (num > 10) {
    num /= 10;
  }
  console.log("getBelowTen() result", Math.floor(num));
  return Math.floor(num);
}

function printGameStatus(appState: Field[]) {
  console.log('-'.repeat(30));
  const isAntePhase = appState[0].toString() === "0";
  if (isAntePhase) {
    console.log('ANTE phase. Pay to join the game!');
    console.log('Current min bet is', appState[1].toString() + "MINA");
    console.log("\nPlayer Status")
    console.log('Player One paid Ante and is waiting?', appState[2].toString() === "0" ? "No" : "Yes");
    console.log('Player Two paid Ante?', appState[3].toString() === "0" ? "No" : "Yes");
  } else {
    // betting phase
    console.log('Betting Phase.');
    console.log('Current min bet is', appState[1].toString() + "MINA");
    console.log("\nPlayer Status")
    console.log("is it your turn?", appState[4].toString() === "1" ? "No" : "Yes")
    console.log('Player One\'s card is ', appState[5].toString());
  }

  // console.log('Whos Turn', appState[4].toString());
  // console.log('Player One Card', appState[5].toString());
  // console.log('Player Two Card', appState[6].toString());
  // console.log('Winner Hash', appState[7].toString());
  console.log('-'.repeat(30));
}

class BlindMansBluff extends SmartContract {
  // The state of the game: 0 -> antePhase, 1 -> betPhase, 2 -> end
  @state(Bool) isAntePhaseDone: State<Bool>;
  @state(UInt64) minBet: State<Field>;
  @state(Bool) anteOne: State<Bool>;
  @state(Bool) anteTwo: State<Bool>;

  // for betting phase
  @state(Bool) playerOneTurn: State<Bool>;
  @state(UInt64) cardOne: State<Field>;
  @state(UInt64) cardTwo: State<Field>;
  @state(Field) winnerHash: State<Field>;

  // is there max number of states in a smart contract?
  player1: PublicKey;
  player2: PublicKey;

  constructor(initialBalance: UInt64, address: PublicKey, player1: PublicKey, player2: PublicKey) {
    super(address);
    this.balance.addInPlace(initialBalance);
    this.isAntePhaseDone = State.init(new Bool(false));
    this.anteOne = State.init(new Bool(false));
    this.anteTwo = State.init(new Bool(false));
    this.cardOne = State.init(Field.zero);
    this.cardTwo = State.init(Field.zero);
    this.winnerHash = State.init(Field.zero);
    this.player1 = player1;
    this.player2 = player2;
    this.playerOneTurn = State.init(new Bool(true));
    this.minBet = State.init(new Field(100));
  }

  @method
  async getUserOneAnte() {
    return await this.anteOne.get();
  }

  @method
  async getUserTwoAnte() {
    return await this.anteTwo.get();
  }

  @method
  async payAnte(playerPublicKey: PublicKey, signature: Signature, betAmount: UInt64) {
    // START: same asserting logics for async bet()
    const isAntePhaseDone = await this.isAntePhaseDone.get();
    isAntePhaseDone.assertEquals(new Bool(false));
    const minBet = await this.minBet.get(); // diff: ante bet should be all equal
    minBet.equals(betAmount.value).assertEquals(true);
    signature.verify(playerPublicKey, betAmount.toFields()).assertEquals(true);
    const player1 = this.player1;
    const player2 = this.player2;
    Bool.or(playerPublicKey.equals(player1), playerPublicKey.equals(player2)).assertEquals(true);
    // END: same asserting logics for async bet()

    // check if caller is player 1 or player 2
    const isPlayerOne = Circuit.if(playerPublicKey.equals(player1), new Bool(true), new Bool(false));

    const isPlayerOnePaidAnte = await this.anteOne.get();
    const isPlayerTwoPaidAnte = await this.anteTwo.get();
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
            isPlayerOnePaidAnte.not(),
          ),
          isPlayerTwoPaidAnte.not(),
        ),
        Bool.and(
          Bool.and(
            isPlayerOne,
            isPlayerOnePaidAnte.not(),
          ),
          isPlayerTwoPaidAnte.not(),
        ),
      ),
      Bool.or(
        Bool.and(
          Bool.and(
            isPlayerOne,
            isPlayerOnePaidAnte.not(),
          ),
          isPlayerTwoPaidAnte,
        ),
        Bool.and(
          Bool.and(
            isPlayerOne.not(),
            isPlayerOnePaidAnte,
          ),
          isPlayerTwoPaidAnte.not(),
        ),
      ),
    );
    // console.log('\n\n====== DEBUG assertion circuit ======');
    // console.log('isPlayerOne (A)', isPlayerOne.toBoolean());
    // console.log('isPlayerOnePaid (B)', isPlayerOnePaidAnte.toBoolean());
    // console.log('isPlayerTwoPaid (C)', isPlayerTwoPaidAnte.toBoolean());
    // console.log('result (Y)', isGoodToPayAnte.toBoolean());
    isGoodToPayAnte.assertEquals(true);

    // isPlayerOne      (A) T | T | F | F
    // isPlayerOnePaid  (B) T | F | T | F
    // result           (Y) F | T | T | F
    // if it is player one's call, check and update, if it's player two's call, just use (B) value
    // Y = AB' + A'B
    //   => or(and(a, not(b)), and(not(a), b))
    const y = Bool.or(
      Bool.and(
        isPlayerOne,
        isPlayerOnePaidAnte.not(),
      ),
      Bool.and(
        isPlayerOne.not(),
        isPlayerOnePaidAnte,
      ));
    // console.log('\n\n====== DEBUG circuit ======');
    // console.log('isPlayerOne (A)', isPlayerOne.toBoolean());
    // console.log('isPlayerOnePaid (B)', isPlayerOnePaidAnte.toBoolean());
    // console.log('result (Y)', y.toBoolean());

    // isPlayerOne      (A) T | T | F | F
    // isPlayerTwoPaid  (C) T | F | T | F
    // result           (Y')T | F | F | T
    // same logic with player one, but inverse
    // yy = AC + A'C'
    //   => or(and(a, c), and(not(a), not(b)))
    const yy = Bool.or(
      Bool.and(isPlayerOne, isPlayerTwoPaidAnte),
      Bool.and(isPlayerOne.not(), isPlayerTwoPaidAnte.not()),
    );
    // console.log('\n\n====== DEBUG circuit two ======');
    // console.log('isPlayerOne (A)', isPlayerOne.toBoolean());
    // console.log('isPlayerTwoPaid (C)', isPlayerTwoPaidAnte.toBoolean());
    // console.log('result (Y\')', yy.toBoolean());

    this.anteOne.set(new Bool(y));
    this.anteTwo.set(new Bool(yy));

    // (await this.anteOne.get()).assertEquals(y);
    // (await this.anteTwo.get()).assertEquals(newY);
    // console.log('AnteOne', (await this.anteOne.get()).toBoolean(), y.toBoolean());
    // console.log('AnteTwo', (await this.anteTwo.get()).toBoolean(), yy.toBoolean());

    // when everyone is done paying there ante, change game phase to giving one card each
    const isEveryoneReady = Bool.and(
      new Bool(y),
      new Bool(yy),
    );

    this.isAntePhaseDone.set(isEveryoneReady);
    const userOneCard = Circuit.if(isEveryoneReady, Field.random(), Field.zero);
    const userTwoCard = Circuit.if(isEveryoneReady, Field.random(), Field.zero);

    this.cardOne.set(new Field(getBelowTen(userOneCard.toString())));
    this.cardTwo.set(new Field(getBelowTen(userTwoCard.toString())));
    // this.balance.addInPlace(betAmount);
  }

  @method
  async didIWin(playerPublicKey: PublicKey) {
    //TODO: my public key + opponents number => bool
  }

  @method
  async initializeGame(playerPublicKey: PublicKey, signature: Signature) {
    // START: same asserting logics from async bet()
    // ...
    // END: same asserting logics from async bet()
    // after i am verified

    // derive random number from transaction maybe random in the future, currently 'txn hash'
    // const maybeRandomValue = this.transactionHash();
    // TODO: this is a rough implementation. Users should be able to draw(): () => (opponentsCardNumber, commitmentOfMyNumber)
    // TODO: so this draw method should actually be splitted into two parts: 1. committing my random number part, 2. and fetching
    const userOneNumber = new Field(Math.floor(Math.random() * 10 + 1));
    let userTwoNumber = new Field(Math.floor(Math.random() * 10 + 1));
    while (userOneNumber.equals(userTwoNumber).toBoolean()) {
      userTwoNumber = new Field(Math.floor(Math.random() * 10 + 1));
    }

    const disUserOneWin = userOneNumber.gt(userTwoNumber);

    console.log('draw userOne', userOneNumber.toString());
    console.log('draw userTwo', userTwoNumber.toString());

    const resultHash = Poseidon.hash([userOneNumber, userTwoNumber, disUserOneWin.toField()]);

    // so i will use this number to check the winner when the game ends
    console.log('resultHash', resultHash);
    this.winnerHash.set(resultHash);

    // assign account1's provided random number to account2
    // this.cardOne.set(providedRandomNumber);
    // this.cardTwo.set(providedRandomNumber);
  }

  @method
  async bet(playerPublicKey: PublicKey, signature: Signature, betAmount: UInt64) {
    // 1. continue only if the gamephase is in betting phase
    const isAntePhaseDone = await this.isAntePhaseDone.get();
    isAntePhaseDone.assertEquals(new Bool(true));

    // 2. continue only if the bet amount is higher than the current min bet
    // const minBet = await this.minBet.get();
    // some kind of error assertGte is not a function??
    // minBet.assertGte(betAmount.value);

    // 3. verify that you are the one who signed the betting transaction
    signature.verify(playerPublicKey, betAmount.toFields()).assertEquals(true);

    // 4. check that the player is within the users whitelisted to play this game
    const player1 = this.player1;
    const player2 = this.player2;
    Bool.or(playerPublicKey.equals(player1), playerPublicKey.equals(player2)).assertEquals(true);

    // 5. check if it is my turn to bet
    const isCallerPlayerOne = Circuit.if(playerPublicKey.equals(player1), new Bool(true), new Bool(false));
    const isPlayerOneTurn = await this.playerOneTurn.get();
    isCallerPlayerOne.assertEquals(isPlayerOneTurn);

    // verification is done. lets change the state now
    this.minBet.set(betAmount.value);
    this.playerOneTurn.set(isPlayerOneTurn.not());
  }
}

export async function run() {
  await isReady;

  // initialize mina local blockchain
  const Local = Mina.LocalBlockchain();
  Mina.setActiveInstance(Local);
  const account1 = Local.testAccounts[0].privateKey;
  const account2 = Local.testAccounts[1].privateKey;
  const a = await Mina.getAccount(account1.toPublicKey());
  const b = await Mina.getAccount(account2.toPublicKey());
  console.log('Initial Account1 balance', a.balance.value.toString());
  console.log('Initial Account2 balance', b.balance.value.toString());

  // const account3 = Local.testAccounts[2].privateKey;
  // const account4 = Local.testAccounts[3].privateKey;

  const snappPrivkey = PrivateKey.random();
  const snappPubkey = snappPrivkey.toPublicKey();
  let game: BlindMansBluff;

  // we will use rl to take console input from user for demo
  const rl = readline.createInterface({
    input: process.stdin, //or fileStream
    output: process.stdout,
  });

  console.log('Deploying the Contract, balance', a.balance.value.toString());
  await Mina.transaction(account1, async () => {
    // account2 sends 10000000123 to the new snapp account
    const amount = UInt64.fromNumber(1000000123);
    const p = await Party.createSigned(account2);
    p.balance.subInPlace(amount);
    // two players committed to play the blind mans bluff
    game = new BlindMansBluff(amount, snappPubkey, account1.toPublicKey(), account2.toPublicKey());
  })
    .send()
    .wait();

  await Mina.transaction(account1, async () => {
    const anteBetAmount = UInt64.fromNumber(100);
    const sig = Signature.create(account1, anteBetAmount.toFields());
    await game.payAnte(account1.toPublicKey(), sig, anteBetAmount);
  })
    .send()
    .wait()
    .catch(e => console.log(e));

  const contract = await Mina.getAccount(snappPubkey);
  printGameStatus(contract.snapp.appState);

  let isGameEnded = false;

  while (!isGameEnded) {
    let doWhat = await new Promise<string>((resolve) => {
      rl.question('' +
        'Press [1] to pay 100 MINA as Ante and join the game \n' +
        'Press [2] to see opponents card number \n' +
        'Press [3] to wait for opponent to place his bet \n' +
        'Press [4] to place the bet, Press [5] to fold: \n'
        , resolve);
      // rl.question('Press [3] to see opponents card number: ', resolve);
    });

    switch (Number(doWhat)) {
      case GameActions.PLAYER_TWO_PAY_ANTE: {
        await Mina.transaction(account2, async () => {
          const anteBetAmount = UInt64.fromNumber(100);
          const sig = Signature.create(account2, anteBetAmount.toFields());
          // const p = await Party.createSigned(account2);
          // p.balance.subInPlace(anteBetAmount);
          await game.payAnte(account2.toPublicKey(), sig, anteBetAmount);
        })
          .send()
          .wait()
          .catch(e => console.log(e));

        // game loop end
        let b = await Mina.getAccount(snappPubkey);
        printGameStatus(b.snapp.appState);
        break;
      }
      case GameActions.CHECK_OPPONENTS_CARD: {
        // game loop end
        let b = await Mina.getAccount(snappPubkey);
        console.log("\n###############################################");
        console.log('Player One\'s card is ', b.snapp.appState[5].toString());
        console.log("###############################################\n");
        break;
      }
      case GameActions.PLAYER_ONE_BET: {
        await Mina.transaction(account1, async () => {
          const anteBetAmount = UInt64.fromNumber(300);
          const sig = Signature.create(account1, anteBetAmount.toFields());
          // const p = await Party.createSigned(account2);
          // p.balance.subInPlace(anteBetAmount);
          await game.bet(account1.toPublicKey(), sig, anteBetAmount);
        })
          .send()
          .wait()
          .catch(e => console.log(e));
        // game loop end
        let b = await Mina.getAccount(snappPubkey);
        printGameStatus(b.snapp.appState);
        console.log("\n###############################################");
        console.log("##### Player One just bet 300 MINA #####");
        console.log("###############################################\n");
        break;
      }
      default: {
        console.log('Wrong input, try again');
        // game loop end
        let b = await Mina.getAccount(snappPubkey);
        printGameStatus(b.snapp.appState);
      }
    }
  }

  // ante phase is done, any user should initialize the game
  await Mina.transaction(account1, async () => {
    const sig = Signature.create(account1, []);
    await game.initializeGame(account1.toPublicKey(), sig);
  })
    .send()
    .wait()
    .catch(e => console.log(e));

  // once game is initialized, the winner is already decided.
  // didIWin?
  await Mina.transaction(account1, async () => {
    // const sig = Signature.create(account1, []);
    await game.didIWin(account1.toPublicKey());
  })
    .send()
    .wait()
    .catch(e => console.log(e));

  console.log('After Ante Betting from user 2');
  // @ts-ignore
  console.log('State[4] anteOne', (await game.getUserOneAnte()).toBoolean());
  // @ts-ignore
  console.log('State[5] anteTwo', (await game.getUserTwoAnte()).toBoolean());
  // console.log("Game Finished current state");
  // console.log("State[4] anteOne", (await game.getUserOneAnte()).toBoolean());
  // console.log("State[5] anteTwo", (await game.getUserTwoAnte()).toBoolean());
  // console.log("Account1 balance", a.balance.value.toString());
  // console.log("Account2 balance", b.balance.value.toString());
  // console.log("Contract balance", contract.balance.value.toString());
}

run();
shutdown();
