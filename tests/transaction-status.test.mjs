import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createSupabaseTestDatabase } from './helpers/supabaseTestDatabase.mjs';

const id = n => `35000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const [admin,officeAdmin,supervisor,agent,client,otherSupervisor,otherAgent,outsideClient] = [1,2,3,4,5,6,7,8].map(id);
const [office,outsideOffice] = [101,102].map(id);
let db;
const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
async function rollback(action) {
  await db.exec('BEGIN');
  try { await action(); } finally { await db.exec('ROLLBACK'); }
}
async function asUser(actor, action) {
  await db.exec('SAVEPOINT caller');
  try {
    await db.exec(`SET ROLE ${actor ? 'authenticated' : 'anon'}`);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [actor || '',actor ? 'authenticated' : 'anon']);
    const value = await action();
    await db.exec('RESET ROLE; RELEASE SAVEPOINT caller');
    await db.exec("SELECT set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false)");
    return value;
  } catch(error) { await db.exec('ROLLBACK TO SAVEPOINT caller; RELEASE SAVEPOINT caller'); throw error; }
}
const createRequest = async (type='deposit', currency='EUR', customer=client, crypto=false, quantity=0.5) => scalar(
  'INSERT INTO transaction_requests(customer_id,type,method,amount,currency,crypto_id,crypto_symbol,crypto_name,quantity,unit_price) VALUES ($1,$2,$3,100,$4,$5,$6,$7,$8,$9) RETURNING id',
  [customer,type,crypto ? 'crypto_wallet' : 'bank_transfer',currency,crypto ? 'bitcoin' : null,crypto ? 'BTC' : null,crypto ? 'Bitcoin' : null,crypto ? quantity : null,crypto ? 200 : null]);
const change = (tx,status,expected,actor=admin,message=`Changed to ${status}`) => asUser(actor, () => db.query(
  'SELECT * FROM public.review_transaction_request($1,$2,$3,$4)', [tx,status,expected,message]));
const cash = (currency='EUR') => scalar('SELECT balance FROM customer_balances WHERE customer_id=$1 AND currency=$2',[client,currency]).then(Number);
const holding = () => scalar("SELECT quantity FROM portfolio_items WHERE user_id=$1 AND crypto_id='bitcoin'",[client]).then(Number);
const row = async tx => (await db.query('SELECT * FROM transaction_requests WHERE id=$1',[tx])).rows[0];

before(async () => {
  db = await createSupabaseTestDatabase();
  for(const user of [admin,officeAdmin,supervisor,agent,client,otherSupervisor,otherAgent,outsideClient]) {
    await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,$2,'{}')",[user,`${user}@example.test`]);
  }
  await db.query("INSERT INTO groups(id,name) VALUES ($1,'Office'),($2,'Outside')",[office,outsideOffice]);
  await db.query('UPDATE profiles SET group_id=$1 WHERE id=ANY($2::uuid[])',[office,[officeAdmin,supervisor,agent,client,otherSupervisor,otherAgent]]);
  await db.query('UPDATE profiles SET group_id=$1 WHERE id=$2',[outsideOffice,outsideClient]);
  for(const [user,role] of [[admin,'admin'],[officeAdmin,'group_admin'],[supervisor,'supervisor'],[otherSupervisor,'supervisor'],[agent,'agent'],[otherAgent,'agent']]) {
    await db.query('INSERT INTO user_roles(user_id,role) VALUES ($1,$2)',[user,role]);
  }
  await db.query('UPDATE profiles SET supervisor_id=$1 WHERE id=$2',[supervisor,agent]);
  await db.query('UPDATE profiles SET supervisor_id=$1 WHERE id=$2',[otherSupervisor,otherAgent]);
  await db.query('UPDATE profiles SET assigned_to=$1 WHERE id=$2',[agent,client]);
  await db.query('UPDATE customer_balances SET balance=1000 WHERE customer_id=$1',[client]);
  await db.query("INSERT INTO portfolio_items(user_id,crypto_id,crypto_symbol,crypto_name,quantity,purchase_price) VALUES ($1,'bitcoin','BTC','Bitcoin',2,100)",[client]);
});
after(async () => { await db?.close(); });

for(const type of ['deposit','withdraw']) for(const currency of ['EUR','USD','CAD']) {
  test(`${currency} ${type} can move through every status repeatedly with exactly one active balance effect`, async () => rollback(async () => {
    const tx = await createRequest(type,currency);
    let previous = 'pending';
    const before = await scalar('SELECT count(*)::int FROM notifications WHERE user_id=$1',[client]);
    for(const status of ['approved','pending','approved','rejected','processing','approved','processing','pending']) {
      await change(tx,status,previous);
      assert.equal(await cash(currency),1000+(status==='approved' ? type==='deposit' ? 100 : -100 : 0));
      const current = await row(tx);
      assert.equal(current.status,status);
      assert.equal(current.balance_applied_at !== null,status==='approved');
      assert.equal(current.processed_by,status==='pending' ? null : admin);
      assert.equal(current.processed_at !== null,status!=='pending');
      assert.equal(current.review_message,`Changed to ${status}`);
      for(const other of ['EUR','USD','CAD'].filter(value => value!==currency)) assert.equal(await cash(other),1000);
      previous=status;
    }
    assert.equal(await scalar('SELECT count(*)::int FROM notifications WHERE user_id=$1',[client]),before+8);
  }));
}

for(const type of ['deposit','withdraw']) test(`crypto ${type} approval and reversal change only holdings and preserve cost metadata`, async () => rollback(async () => {
  const tx = await createRequest(type,'USD',client,true,type==='withdraw' ? 2 : 0.5);
  const quantity = type==='withdraw' ? 2 : 0.5;
  let previous='pending';
  for(const status of ['approved','rejected','approved','pending','processing','approved']) {
    await change(tx,status,previous);
    assert.equal(await holding(),2+(status==='approved' ? (type==='deposit' ? quantity : -quantity) : 0));
    assert.equal(Number(await scalar("SELECT purchase_price FROM portfolio_items WHERE user_id=$1 AND crypto_id='bitcoin'",[client])),100);
    for(const currency of ['EUR','USD','CAD']) assert.equal(await cash(currency),1000);
    previous=status;
  }
}));

test('stale and repeated approvals never apply the amount twice or send extra notifications', async () => rollback(async () => {
  const tx = await createRequest();
  await change(tx,'approved','pending');
  const count = await scalar('SELECT count(*)::int FROM notifications WHERE user_id=$1',[client]);
  await assert.rejects(change(tx,'rejected','pending'),/request changed/);
  await assert.rejects(change(tx,'approved','approved'),/different transaction status/);
  await db.query("UPDATE transaction_requests SET status='approved' WHERE id=$1",[tx]);
  assert.equal(await cash(),1100);
  assert.equal(await scalar('SELECT count(*)::int FROM notifications WHERE user_id=$1',[client]),count);
}));

test('insufficient funds roll back status, message, notification and balance together', async () => rollback(async () => {
  const tx = await createRequest();
  await change(tx,'approved','pending');
  await db.query("UPDATE customer_balances SET balance=50 WHERE customer_id=$1 AND currency='EUR'",[client]);
  const before = await row(tx);
  const count = await scalar('SELECT count(*)::int FROM notifications WHERE user_id=$1',[client]);
  await assert.rejects(change(tx,'pending','approved'),/Insufficient EUR balance/);
  assert.deepEqual(await row(tx),before);
  assert.equal(await cash(),50);
  assert.equal(await scalar('SELECT count(*)::int FROM notifications WHERE user_id=$1',[client]),count);
}));

test('transaction amounts and application markers cannot be rewritten after approval', async () => rollback(async () => {
  const tx = await createRequest();
  await change(tx,'approved','pending');
  for(const sql of ['UPDATE transaction_requests SET amount=200 WHERE id=$1','UPDATE transaction_requests SET balance_applied_at=NULL WHERE id=$1']) {
    await assert.rejects(asUser(admin,()=>db.query(sql,[tx])),/Reopen|managed automatically/);
  }
  assert.equal(await cash(),1100);
  assert.equal(Number((await row(tx)).amount),100);
}));

test('all scoped staff can revise decisions; clients, other subtrees and anonymous callers cannot', async () => rollback(async () => {
  for(const actor of [admin,officeAdmin,supervisor,agent]) {
    const tx = await createRequest('withdraw');
    await change(tx,'approved','pending',actor);
    await change(tx,'pending','approved',actor);
    assert.equal(await cash(),1000);
  }
  for(const actor of [client,otherSupervisor,otherAgent,null]) {
    const tx = await createRequest();
    await assert.rejects(change(tx,'approved','pending',actor),/cannot manage|permission denied|Authentication/);
    assert.equal((await row(tx)).status,'pending');
  }
  const outside = await createRequest('deposit','EUR',outsideClient);
  await assert.rejects(change(outside,'approved','pending',officeAdmin),/cannot manage/);
  assert.equal(await cash(),1000);
  assert.equal(await scalar("SELECT has_function_privilege('anon','public.review_transaction_request(uuid,public.transaction_status,public.transaction_status,text)','EXECUTE')"),false);
}));

test('long messages fail without applying a balance effect', async () => rollback(async () => {
  const tx = await createRequest();
  await assert.rejects(change(tx,'approved','pending',admin,'x'.repeat(2001)),/at most 2000/);
  assert.equal((await row(tx)).status,'pending');
  assert.equal(await cash(),1000);
}));
