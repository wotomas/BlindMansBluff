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
  shutdown, CircuitValue, prop, Signature, UInt32, Bool, Circuit,
} from 'snarkyjs';

// a public ledger that only the person who created (owner) can update
class CircuitPractice extends SmartContract {
  @state(Bool) and: State<Bool>;
  @state(Bool) or: State<Bool>;
  @state(Bool) xor: State<Bool>;

  constructor(initialBalance: UInt64, address: PublicKey) {
    super(address);
    this.balance.addInPlace(initialBalance);
    this.and = State.init(new Bool(false));
    this.or = State.init(new Bool(false));
    this.xor = State.init(new Bool(false));
  }

  // xor
  // a T | T | F | F
  // b T | F | T | F
  // y F | T | T | F
  // y = AB' + A'B
  @method async update(first: boolean, second: boolean) {
    this.or.set(Bool.or(
      new Bool(first),
      new Bool(second),
    ));

    this.and.set(Bool.and(
      new Bool(first),
      new Bool(second),
    ));

    this.xor.set(Bool.or(
      Bool.and(
        new Bool(first),
        new Bool(second).not()
      ),
      Bool.and(
        new Bool(first).not(),
        new Bool(second)
      )
    ))
  }
}

export async function run() {
  await isReady;

  // initialize mina local blockchain
  const Local = Mina.LocalBlockchain();
  Mina.setActiveInstance(Local);
  const account1 = Local.testAccounts[0].privateKey;
  const account2 = Local.testAccounts[1].privateKey;
  const snappPrivkey = PrivateKey.random();
  const snappPubkey = snappPrivkey.toPublicKey();

  let snappInstance: CircuitPractice;

  // Deploys the snapp
  await Mina.transaction(account1, async () => {
    // account2 sends 1000000000 to the new snapp account
    const amount = UInt64.fromNumber(1000000000);
    const p = await Party.createSigned(account2);
    p.balance.subInPlace(amount);

    snappInstance = new CircuitPractice(amount, snappPubkey);

  })
    .send()
    .wait();

  // Update the snapp
  await Mina.transaction(account1, async () => {
    // this will throw error if I send it using account 2, since it does not have owner access
    await snappInstance.update(true, true);
  })
    .send()
    .wait();

  const a = await Mina.getAccount(snappPubkey);

  console.log('Exercise 1');
  console.log('final state value (and)', a.snapp.appState[0].toString() === "1" ? "true" : "false");
  console.log('final state value (or)', a.snapp.appState[1].toString() === "1" ? "true" : "false");
  console.log('final state value (xor)', a.snapp.appState[2].toString() === "1" ? "true" : "false");
}

run();
shutdown();
