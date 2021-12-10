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
  Poseidon,
  shutdown,
  isReady,
} from 'snarkyjs';

// We can define functions. Use a for-loop to define a function
// that applies Poseidon.hash `n` times.
function hashNTimes(n: number, x: Field): Field {
  throw new Error('TODO: hashNTimes');
}

class Exercise4 extends SmartContract {
  @state(Field) x: State<Field>;

  constructor(initialBalance: UInt64, address: PublicKey, x: Field) {
    super(address);
    this.balance.addInPlace(initialBalance);
    this.x = State.init(x);
  }

  @method async update() {
    const x = await this.x.get();
    // apply the hash function 10 times
    this.x.set(hashNTimes(10, x));
  }
}

export async function run() {
  await isReady;

  const Local = Mina.LocalBlockchain();
  Mina.setActiveInstance(Local);
  const account1 = Local.testAccounts[0].privateKey;
  const account2 = Local.testAccounts[1].privateKey;

  const snappPrivkey = PrivateKey.random();
  const snappPubkey = snappPrivkey.toPublicKey();

  let snappInstance: Exercise4;
  const initSnappState = new Field(3);

  // Deploys the snapp
  await Mina.transaction(account1, async () => {
    // account2 sends 1000000000 to the new snapp account
    const amount = UInt64.fromNumber(1000000000);
    const p = await Party.createSigned(account2);
    p.balance.subInPlace(amount);

    snappInstance = new Exercise4(amount, snappPubkey, initSnappState);
  })
    .send()
    .wait();

  // Update the snapp, send the reward to account2
  await Mina.transaction(account1, async () => {
    await snappInstance.update();
  })
    .send()
    .wait();

  const a = await Mina.getAccount(snappPubkey);

  console.log('Exercise 4');

  console.log('final state value', a.snapp.appState[0].toString());
}

run();
shutdown();
