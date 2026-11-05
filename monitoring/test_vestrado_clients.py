import json
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from vestrado_clients import classify, inspect

MT5 = SimpleNamespace(DEAL_TYPE_BUY=0, DEAL_TYPE_SELL=1, DEAL_TYPE_BALANCE=2,
                      DEAL_TYPE_CREDIT=3, DEAL_TYPE_CORRECTION=5, DEAL_TYPE_BONUS=6)
MAPPING = json.loads((Path(__file__).parent / "vestrado-mapping.json").read_text())["servers"]["vestrado-server"]

def deal(kind, amount, comment="", ticket=1):
    return SimpleNamespace(type=kind, profit=amount, comment=comment, volume=.01,
                           commission=0, swap=0, fee=0, ticket=ticket, time_msc=int(time.time()*1000)-1000)

class ClassificationTests(unittest.TestCase):
    def test_verified_sdk_constants_and_reviewed_mapping(self):
        for comment in ("D DGPay v2 #123", "D Online Banking VTP (FPX)"):
            self.assertEqual(classify(deal(2,300,comment),MAPPING,MT5),("deposit",300))
        for comment in ("W DGPay v2 #123", "W IT-Payment Gateway (AWP)"):
            self.assertEqual(classify(deal(2,-50,comment),MAPPING,MT5),("withdrawal",-50))
    def test_bonus_cannot_become_cash_even_with_deposit_comment(self):
        for kind in (3,6):
            self.assertEqual(classify(deal(kind,300,"D DGPay v2 #123"),MAPPING,MT5),("bonus",300))
    def test_bonus_transfer_review_is_account_specific(self):
        reviewed = dict(MAPPING, reviewed_bonus_comments=["IT 987"])
        self.assertEqual(classify(deal(2,300,"IT 987"),reviewed,MT5),("bonus",300))
        self.assertEqual(classify(deal(2,300,"IT 987"),MAPPING,MT5),("unknown",300))
        self.assertEqual(classify(deal(2,300,"IT 999"),reviewed,MT5),("unknown",300))
    def test_adjustment_is_not_a_deposit(self):
        for kind in (2,5):
            self.assertEqual(classify(deal(kind,100,"Bonus Negative Balance"),MAPPING,MT5),("adjustment",100))
        self.assertEqual(classify(deal(5,300,"D DGPay v2 #123"),MAPPING,MT5),("unknown",300))
    def test_trade_costs_are_included_and_zero_volume_is_not_a_trade(self):
        d=deal(0,20);d.commission=-1;d.swap=-2;d.fee=-.5
        self.assertEqual(classify(d,MAPPING,MT5),("trade",16.5))
        d.volume=0
        self.assertEqual(classify(d,MAPPING,MT5),("unknown",16.5))

class FakeMT5:
    def __init__(self, folder, deals, balance=300, credit=100):
        self.__dict__.update(MT5.__dict__)
        self.ACCOUNT_TRADE_MODE_REAL=2
        self.folder=folder;self.deals=deals;self.login_calls=0;self.initialize_args=None
        self.info=SimpleNamespace(login=12345,server="Vestrado-Server",currency="USD",trade_mode=2,
                                  trade_allowed=False,company="Vestrado Ltd.",balance=balance,equity=balance+credit,credit=credit)
    def initialize(self,*args,**kwargs):
        self.initialize_args=(args,kwargs);return True
    def terminal_info(self):
        return SimpleNamespace(path=str(self.folder),data_path=str(self.folder),connected=True)
    def login(self,*args,**kwargs):
        self.login_calls+=1;return True
    def account_info(self):return self.info
    def history_deals_get(self,*args):return self.deals
    def history_deals_total(self,*args):return len(self.deals)

class ObserverTests(unittest.TestCase):
    def setUp(self):
        self.folder=Path("/tmp/Panther-Client-Monitor").resolve()
        self.account={"mt5_login":"12345","server":"Vestrado-Server","investor_password":"test-only", "user_id":"test-owner","revision":"test-revision"}
    def test_no_client_credentials_passed_until_terminal_path_verified(self):
        fake=FakeMT5(Path("/tmp/price-feed"),[])
        with self.assertRaisesRegex(RuntimeError,"path mismatch"):
            inspect(fake,self.account,self.folder/"terminal64.exe",MAPPING)
        self.assertEqual(fake.login_calls,0)
        self.assertNotIn("password",fake.initialize_args[1])
    def test_balance_reconciliation_keeps_credit_separate(self):
        fake=FakeMT5(self.folder,[deal(2,300,"D DGPay v2 #1"),deal(3,100,"Bonus In",2)])
        result=inspect(fake,self.account,self.folder/"terminal64.exe",MAPPING)
        self.assertEqual(result["balance"],300)
        self.assertEqual(result["credit"],100)
        self.assertEqual([d["kind"] for d in result["deals"]],["deposit","bonus"])
    def test_balance_type_bonus_is_reconciled_but_not_cash(self):
        fake=FakeMT5(self.folder,[deal(2,100,"D DGPay v2 #1"),deal(6,200,"Bonus In",2)],balance=300,credit=0)
        result=inspect(fake,self.account,self.folder/"terminal64.exe",MAPPING)
        self.assertEqual([d["kind"] for d in result["deals"]],["deposit","bonus"])
    def test_truncated_history_and_master_access_fail_closed(self):
        fake=FakeMT5(self.folder,[deal(2,100,"D DGPay v2 #1")])
        with self.assertRaisesRegex(RuntimeError,"reconcile"):
            inspect(fake,self.account,self.folder/"terminal64.exe",MAPPING)
        fake.info.trade_allowed=True
        with self.assertRaisesRegex(RuntimeError,"read-only"):
            inspect(fake,self.account,self.folder/"terminal64.exe",MAPPING)

if __name__=="__main__":unittest.main()
