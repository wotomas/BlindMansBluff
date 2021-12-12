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
  shutdown, CircuitValue, prop, Signature, UInt32, Bool,
} from 'snarkyjs';

// a public ledger that only the person who created (owner) can update
class Exercise1Access extends SmartContract {
  @state(Field) db: State<Field>;
  @state(PublicKey) owner: State<PublicKey>;
  @state(Bool) testingBool: State<Bool>;

  constructor(initialBalance: UInt64, address: PublicKey, owner: PublicKey, initialValue: Field) {
    super(address);
    this.balance.addInPlace(initialBalance);
    this.testingBool = State.init(new Bool(false));
    this.owner = State.init(owner);
    this.db = State.init(initialValue);
  }

  // need to take public key of the player and a signature to make sure that they own the public key
  @method async update(newValue: Field, publicKey: PublicKey, signature: Signature) {
    // first verify that public key is is hardcoded
    const owner = await this.owner.get();
    owner.equals(publicKey).assertEquals(true);

    // Verify the signature
    signature.verify(publicKey, [newValue]).assertEquals(true);

    this.db.set(newValue);
    this.testingBool.set(new Bool(true));
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

  let snappInstance: Exercise1Access;
  const initSnappState = new Field(3);

  // Deploys the snapp
  await Mina.transaction(account1, async () => {
    // account2 sends 1000000000 to the new snapp account
    const amount = UInt64.fromNumber(1000000000);
    const p = await Party.createSigned(account2);
    p.balance.subInPlace(amount);

    snappInstance = new Exercise1Access(amount, snappPubkey, account1.toPublicKey(), initSnappState);
    // console.log('initial state value', a.snapp.appState[0].toString());
    // console.log('initial state value', a.snapp.appState[1].toString());
    // console.log('initial state value', a.snapp.appState[2].toString());
  })
    .send()
    .wait();

  // Update the snapp
  await Mina.transaction(account1, async () => {
    const newMessage = new Field(51);
    const signature = Signature.create(account1, [newMessage]);

    // this will throw error if I send it using account 2, since it does not have owner access
    await snappInstance.update(newMessage, account1.toPublicKey(), signature);
  })
    .send()
    .wait();

  const a = await Mina.getAccount(snappPubkey);

  console.log('Exercise 1');
  console.log('final state value', a.snapp.appState[0].toString());
  console.log('final state value', a.snapp.appState[1].toString());
  console.log('final state value', a.snapp.appState[2].toString());
  console.log('final state value', a.snapp.appState[3].toString());
}

run();
shutdown();
