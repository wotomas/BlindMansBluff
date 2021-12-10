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
  shutdown, CircuitValue, prop, Signature, UInt32, Bool, Poseidon,
} from 'snarkyjs';

function ownersHash(owners: Array<PublicKey>): Field {
  return Poseidon.hash(owners.flatMap(owner => owner.toFields()))
}

// a multisig ledger that everyone should exist to change data
class Exercise1Access extends SmartContract {
  @state(Field) db: State<Field>;
  @state(Field) ownersHash: State<Field>;

  constructor(initialBalance: UInt64, address: PublicKey, owners: Array<PublicKey>, initialValue: Field) {
    super(address);
    this.balance.addInPlace(initialBalance);

    this.ownersHash = State.init(ownersHash(owners));
    this.db = State.init(initialValue);
  }

  // need to take public key of the player and a signature to make sure that they own the public key
  @method async update(newValue: Field, publicKeys: PublicKey[], signer: PublicKey, signature: Signature) {
    // first verify that public key is is hardcoded
    const hash = await this.ownersHash.get();
    ownersHash(publicKeys).assertEquals(hash);

    // Verify the signature
    signature.verify(signer, [newValue]).assertEquals(true);

    this.db.set(newValue);
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

    snappInstance = new Exercise1Access(amount, snappPubkey, [account1.toPublicKey(), account2.toPublicKey()], initSnappState);
  })
    .send()
    .wait();

  // Update the snapp
  await Mina.transaction(account1, async () => {
    const newMessage = new Field(51);
    const signature = Signature.create(account2, [newMessage]);

    // this should only work if get all the users that created to contract's public key, and myself
    await snappInstance.update(newMessage, [account1.toPublicKey(), account2.toPublicKey()], account2.toPublicKey(), signature);
  })
    .send()
    .wait();

  const a = await Mina.getAccount(snappPubkey);

  console.log('Exercise 1');
  console.log('final state value', a.snapp.appState[0].toString());
}

run();
shutdown();
