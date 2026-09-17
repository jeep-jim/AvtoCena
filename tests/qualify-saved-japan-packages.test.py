import importlib.util
from pathlib import Path
import unittest
from datetime import datetime, timezone
spec = importlib.util.spec_from_file_location('qualifier', Path(__file__).parents[1]/'scripts/qualify-saved-japan-packages.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class QualificationTest(unittest.TestCase):
    def setUp(self):
        self.row = dict(source='proauctions', sourceId='10', sourceUrl='https://demo.pro-auctions.ru/statistika/toyota/roomy/10.html',
            make='Toyota', model='Roomy', chassis='M900A', year=2021, auctionDate='2026-09-15', auctionName='TAA',
            lotNumber='1', priceJpy=100000, evidenceSha256='a'*64, imageUrls=['https://example/a','https://example/b'])
        self.match = dict(self.row, source='jptrade', sourceUrl='https://jptrade.ru/stat/10', statusRaw='продано')
        self.now = datetime(2026,9,17,tzinfo=timezone.utc)
    def test_export_flags_do_not_prove_sold_or_photos(self):
        r=m.qualify(dict(self.row, publicationReady=True, imagesVerified=True), [], self.now)
        self.assertFalse(r['publicationReady'])
        self.assertIn('sold_status_and_final_price_unconfirmed',r['verificationPending'])
        self.assertIn('gallery_decode_and_content_verification_pending',r['verificationPending'])
    def test_exact_sold_match_only_corroborates_price(self):
        r=m.qualify(self.row,[self.match],self.now)
        self.assertIsNotNone(r['corroboratingSoldLot'])
        self.assertFalse(r['calculationReady'])
        for field in ('priceJpy','chassis','year','make'):
            bad=dict(self.match, **{field: 'different'})
            self.assertIsNone(m.corroborate(self.row,[bad]))
    def test_multiple_matches_do_not_resolve_identity(self):
        self.assertIsNone(m.corroborate(self.row,[self.match,self.match]))
    def test_date_price_and_identity_rejection(self):
        r=m.qualify(dict(self.row,auctionDate='2027-01-01',priceJpy=0,sourceUrl='https://other/10.html'),[],self.now)
        self.assertTrue(set(['auction_date_outside_retention','positive_price_missing','source_identity_invalid']) <= set(r['rejectionReasons']))
    def test_power_conflict_is_not_accepted(self):
        r=m.qualify(dict(self.row,rawFields={'Мощность':'100 л.с. (120 кВт)'}),[],self.now)
        self.assertIn('power_hp_kw_conflict',r['rejectionReasons'])

if __name__ == '__main__': unittest.main()
