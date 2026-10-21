import assert from 'node:assert/strict';
import test from 'node:test';
import { correctSample, postprocess } from '../scripts/catalog-source-field-audit-v1-postprocess.mjs';

function baseSample(sourceId: string) {
  return {
    sourceId,
    requestedUrl: 'https://example.com/car/12345',
    repeat: { stable: true },
    first: {
      summary: {
        sourceOfferId: '12345',
        title: '',
        vehicleJsonLd: [],
        scriptLocalFieldHits: {},
        visibleNamedFieldHits: {},
        labelFieldHits: {},
        diagnosticContexts: {},
        textFieldHits: {},
        images: { listingIdBoundCount: 0 },
        fieldMatrix: { fields: {}, exactReady: false, missingOrAmbiguous: [] },
      },
    },
  } as any;
}

test('Bobaedream hero binds KRW price while keeping unproven body/gallery closed', () => {
  const sample = baseSample('bobaedream_korea_candidate');
  sample.requestedUrl = 'https://www.bobaedream.co.kr/mycar/mycar_view.php?no=2262188&gubun=K';
  sample.first.summary.sourceOfferId = '2262188';
  sample.first.summary.title = '2016 현대 제네시스 DH G330 AWD 프리미엄 중고차 | 보배드림 중고차';
  sample.first.summary.diagnosticContexts.koreanPrice = ['현대 제네시스 DH G330 AWD 프리미엄 16년 04월식 70,595 km 가솔린 1,480 만원 보험료조회'];
  sample.first.summary.labelFieldHits.fuel = [{ label: '연료', value: '가솔린 확인사항 사원증', source: 'table' }];
  sample.first.summary.visibleNamedFieldHits.engine = [{ label: '배기량', value: '3,342 cc', source: 'visible_compound' }];
  sample.first.summary.visibleNamedFieldHits.power = [{ label: '마력', value: '282 마력', source: 'visible_compound' }];
  const matrix = correctSample(sample);
  assert.equal(matrix.fields.make.state, 'exact');
  assert.equal(matrix.fields.model.state, 'exact');
  assert.equal(matrix.fields.year.state, 'exact');
  assert.equal(matrix.fields.price.evidence[0].value, '14800000');
  assert.equal(matrix.fields.currency.evidence[0].value, 'KRW');
  assert.equal(matrix.fields.engineCc.evidence[0].value, '3342');
  assert.equal(matrix.fields.powerHp.evidence[0].value, '282');
  assert.deepEqual(matrix.missingOrAmbiguous, ['body', 'gallery']);
});

test('CARS24 offer-local petrol evidence prevents false electric not-applicable engine state', () => {
  const sample = baseSample('cars24_uae_candidate');
  sample.requestedUrl = 'https://www.cars24.ae/buy-used-ford-territory-2024-cars-dubai-9714841918/';
  sample.first.summary.sourceOfferId = '9714841918';
  sample.first.summary.scriptLocalFieldHits = {
    make: [{ value: 'FORD' }], model: [{ value: 'TERRITORY' }], year: [{ value: '2024' }],
    body: [{ value: 'SUV' }], fuel: [{ value: 'Petrol' }], engine: [{ value: '1.8' }],
    price: [], currency: [], power: [], certifiedPower: [],
  };
  sample.first.summary.visibleNamedFieldHits.fuel = [{ value: 'Used Petrol Cars | Used Electric Cars' }];
  sample.first.summary.textFieldHits.price = ['AED 2,500', 'AED 64,999', 'AED 100,000'];
  sample.first.summary.images.listingIdBoundCount = 15;
  const matrix = correctSample(sample);
  assert.equal(matrix.fields.fuel.evidence[0].value, 'petrol');
  assert.equal(matrix.fields.engineCc.state, 'ambiguous');
  assert.notEqual(matrix.fields.engineCc.state, 'not_applicable');
  assert.equal(matrix.fields.price.state, 'ambiguous');
  assert.equal(matrix.fields.gallery.state, 'exact');
});

test('postprocess refuses unsafe payloads and never mutates classification flags', () => {
  assert.throws(() => postprocess({ productionWrites: true } as any), /unsafe_or_invalid/);
  const payload = postprocess({
    version: 2,
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    results: [],
  } as any);
  assert.equal(payload.productionWrites, false);
  assert.equal(payload.classificationMutations, false);
  assert.equal(payload.publishAllowedMutations, false);
  assert.equal(payload.rawBodiesStored, false);
  assert.equal(payload.postprocessed, true);
  assert.equal(payload.version, 3);
});
