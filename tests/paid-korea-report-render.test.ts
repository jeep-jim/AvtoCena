import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {normalizePaidKoreaReport} from '../apps/web/components/catalog/paid-korea-report-contract';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/paid-korea-report.json', import.meta.url), 'utf8'));
const identity = {offerId: '0123456789abcdef01234567', lot: '42196907', observedAt: '2026-11-13T10:20:30.000Z'};

test('actual report content renders positive and zero KRW facts while unknown stays unknown', async () => {
  const directory = mkdtempSync(join(process.cwd(), '.paid-korea-render-'));
  try {
    const file = join(directory, 'panel.cjs');
    await build({entryPoints: ['apps/web/components/catalog/PaidKoreaReportPanel.tsx'], outfile: file, bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', logLevel: 'silent'});
    const {PaidKoreaReportContent} = createRequire(import.meta.url)(file);
    const render = (source: unknown, kind: 'history' | 'inspection') => renderToStaticMarkup(React.createElement(PaidKoreaReportContent, {report: normalizePaidKoreaReport(source, {...identity, kind})}));
    const history = render(fixture, 'history');
    assert.match(history, /data-paid-korea-count="own">4</);
    assert.match(history, /data-paid-korea-count="other">2</);
    assert.match(history.replace(/\s/g, ''), /3085736KRW/);
    assert.match(history, /Страховая компания владельца/);
    assert.match(history, />0 KRW</);
    assert.match(history, /Частичный ущерб при затоплении<\/dt><dd[^>]*>Нет данных</);
    assert.match(history, /Сведения получены 13\.11\.2026/);
    const zero = render({history: {own_damage_count: 0, own_damage_cost_won: 0}}, 'history');
    assert.match(zero, /data-paid-korea-count="own">0</);
    assert.match(zero, /data-paid-korea-count="other">Нет данных</);
    const missing = render({history: null}, 'history');
    assert.match(missing, /Сведения о страховой истории не предоставлены/);
    assert.doesNotMatch(missing, /data-paid-korea-count|>0 KRW</);
    const inspection = render(fixture, 'inspection');
    assert.match(inspection.replace(/\s/g, ''), /83045км/);
    assert.match(inspection, /3035008743/);
    assert.match(inspection, /ДТП по осмотру<\/dt><dd[^>]*>Нет</);
    assert.match(inspection, /Особая история<\/dt><dd[^>]*>Изменение конструкции</);
    assert.match(inspection, /Изменение назначения<\/dt><dd[^>]*>В отчёте нет отметок</);
    assert.match(inspection, /Переднее левое крыло/);
    assert.match(inspection, /Следы масла/);
    assert.match(inspection, /Обнаружена замена наружной панели/);
    const precise = render({inspection: {co_percent: 0.0005}, diagnosis: null}, 'inspection');
    assert.match(precise, /0,0005 %/);
    assert.match(precise, /Особая история<\/dt><dd[^>]*>Нет данных</);
    assert.match(precise, /Сведения о диагностике не предоставлены/);
    assert.match(render({inspection: null, diagnosis: null}, 'inspection'), /Сведения об осмотре и диагностике не предоставлены/);
    assert.doesNotMatch(history + inspection, /PRIVATE-|KMHAA81KBU1234567|<iframe|<img|href=/);
  } finally {rmSync(directory, {recursive: true, force: true});}
});
