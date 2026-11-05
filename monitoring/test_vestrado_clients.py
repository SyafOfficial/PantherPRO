import unittest
from types import SimpleNamespace
from vestrado_clients import classify

MT5 = SimpleNamespace(DEAL_TYPE_BUY=0, DEAL_TYPE_SELL=1, DEAL_TYPE_BALANCE=2,
                      DEAL_TYPE_CREDIT=3, DEAL_TYPE_CORRECTION=5, DEAL_TYPE_BONUS=6)
MAPPING = {"deposit": r"D DGPay v2 #[0-9]+", "withdrawal": r"W DGPay v2 #[0-9]+", "bonus": r"Bonus.*"}

def deal(kind, amount, comment=""):
    return SimpleNamespace(type=kind, profit=amount, comment=comment,
                           commission=0, swap=0, fee=0)

class ClassificationTests(unittest.TestCase):
    def test_verified_sdk_constants(self):
        self.assertEqual(classify(deal(2,300,"D DGPay v2 #123"),MAPPING,MT5),("deposit",300))
        self.assertEqual(classify(deal(2,-50,"W DGPay v2 #123"),MAPPING,MT5),("withdrawal",-50))
    def test_bonus_cannot_become_cash_even_with_deposit_comment(self):
        for kind in (3,6):
            self.assertEqual(classify(deal(kind,300,"D DGPay v2 #123"),MAPPING,MT5),("bonus",300))
    def test_corrections_and_unverified_transfers_require_review(self):
        self.assertEqual(classify(deal(5,100,"Bonus Negative Balance"),MAPPING,MT5),("unknown",100))
        self.assertEqual(classify(deal(2,100,"IT 123"),MAPPING,MT5),("unknown",100))
    def test_trade_costs_are_included(self):
        d=deal(0,20);d.commission=-1;d.swap=-2;d.fee=-.5
        self.assertEqual(classify(d,MAPPING,MT5),("trade",16.5))

if __name__=="__main__":
    unittest.main()
