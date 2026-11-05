import json, sys
from web3 import Web3
from pathlib import Path
API=str(Path(__file__).resolve().parents[2])
B=json.load(open(f'{API}/tests/fixtures/contract_bytecode.json'))
w=Web3(Web3.HTTPProvider('http://127.0.0.1:8545')); acc=w.eth.accounts
from eth_account import Account
op=Account.from_key('0x'+'11'*32)
w.eth.wait_for_transaction_receipt(w.eth.send_transaction({'from':acc[0],'to':op.address,'value':10**18*5}))
def dep(n,*a):
    abi=json.load(open(f'{API}/smartguard_api/abi/{n}.json'));f=w.eth.contract(abi=abi,bytecode=B[n]['bytecode'])
    r=w.eth.wait_for_transaction_receipt(f.constructor(*a).transact({'from':acc[0]}));return r['contractAddress']
o=dep('RiskOracleContract',op.address); e=dep('EscrowContract',o,45,int(sys.argv[1]),int(sys.argv[2]))
json.dump({'oracle':o,'escrow':e,'operatorKey':'0x'+'11'*32,'accounts':acc[1:5],'block':w.eth.block_number},open('deployed.json','w'))
print(o,e)
