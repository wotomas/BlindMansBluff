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
  shutdown,
} from 'snarkyjs';

class BlindMansBluff extends SmartContract {
  @state(Field) x: State<Field>;

  constructor(initialBalance: UInt64, address: PublicKey, x: Field) {
    super(address);
    this.balance.addInPlace(initialBalance);
    this.x = State.init(x);
  }

  @method
  async update(cubed: Field) {
    const x = await this.x.get();
    x.mul(x).mul(x).assertEquals(cubed);
    this.x.set(cubed);
  }
}

export async function run() {
  await isReady;

  // initialize mina local blockchain
  const Local = Mina.LocalBlockchain();
  Mina.setActiveInstance(Local);
  const account1 = Local.testAccounts[0].privateKey;
  const account2 = Local.testAccounts[1].privateKey;
  const account3 = Local.testAccounts[2].privateKey;
  const account4 = Local.testAccounts[3].privateKey;

  const snappPrivkey = PrivateKey.random();
  const snappPubkey = snappPrivkey.toPublicKey();

  let snappInstance: BlindMansBluff;
  const initSnappState = new Field(3);

  // Deploys the snapp
  await Mina.transaction(account1, async () => {
    // account2 sends 1000000000 to the new snapp account
    const amount = UInt64.fromNumber(1000000000);
    const p = await Party.createSigned(account2);
    p.balance.subInPlace(amount);

    snappInstance = new BlindMansBluff(amount, snappPubkey, initSnappState);
  })
    .send()
    .wait();

  // Update the snapp
  await Mina.transaction(account2, async () => {
    // 27 = 3^3
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
