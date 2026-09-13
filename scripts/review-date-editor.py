from pathlib import Path
import hashlib

ROOT=Path('.')
def read_checked(path,sha):
 p=ROOT/path;b=p.read_bytes()
 actual=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 assert actual==sha,(path,actual,sha)
 return p,b.decode()
def replace(text,old,new):
 assert text.count(old)==1,(old,text.count(old))
 return text.replace(old,new)
p,text=read_checked('apps/web/components/catalog/InlineOfferParameters.tsx','1d4291c28d902b1b0c61bdbc3848f9a6c1e62eea')
text=replace(text,'import { ElectricMotorIcon }','import { CalculationDateControl } from "./CalculationDateControl";\nimport { ElectricMotorIcon }')
helper='''function parameterErrorText(error: unknown, draft: ParameterDraft) {
 const message=error instanceof Error?error.message:"Проверьте параметры";
 const key=message.match(/^Проверьте поле (\\w+)$/)?.[1];
 if(!key)return message;
 const tile=({powerHp:"Мощность",powerKw:"Мощность",power30MinKw:"30-минутная мощность",icePowerKw:"30-минутная мощность",year:"Дата выпуска",productionMonth:"Дата выпуска",productionDay:"Дата выпуска",engineCc:"Объём двигателя"} as Record<string,string>)[key];
 const missing=draft[key]==null || String(draft[key]).trim()==="";
 return `${missing?"Для расчёта под ключ заполните":"Проверьте"} ${names[key]||key}${tile?` в поле «${tile}»`:""}.`;
}
'''
text=replace(text,'function Field(',helper+'function Field(')
text=replace(text,'researchContext="",autoCalculate=false}:{offerId:string;autoCalculate?:boolean;','researchContext="",autoCalculate=false,sourcePriceOnly=false}:{offerId:string;autoCalculate?:boolean;sourcePriceOnly?:boolean;')
text=replace(text,'const message=e instanceof Error?e.message:"Проверьте параметры";setError(message.replace(/Проверьте поле (\\w+)/,(_,key)=>`Укажите корректно ${names[key]||key}`));','setError(parameterErrorText(e,draft));')
text=replace(text,' const showCalculation=dirty || Boolean(result);',' const showCalculation=dirty || Boolean(result);\n // A seller price is not a stale delivered estimate: keep its explicit label while missing data blocks calculation.\n const keepSellerPrice=sourcePriceOnly && !result;')
text=replace(text,'{!showCalculation?price:<div','{!showCalculation || keepSellerPrice?price:<div')
text=replace(text,'{!dirty && autoCalculate && !result ? <p role="status" className="mt-2 text-xs text-[var(--ac-muted)]">{pending?"Рассчитываем по данным объявления…":error}</p> : null}','''{!result && (keepSellerPrice || (!dirty && autoCalculate)) ? <div className="mt-2 text-xs text-[var(--ac-muted)]" data-parameter-calculation-status>
   <p role="status">{pending?"Рассчитываем стоимость под ключ…":error||"Для расчёта под ключ заполните характеристики автомобиля."}</p>
   {keepSellerPrice && dirty ? <button type="button" className="mt-1 py-2 text-xs underline" onClick={()=>{revision.current++;setDraft(initial);setResult(null);setPending(false);}}>Вернуть исходные данные</button> : null}
  </div> : null}''')
text=replace(text,'<label className={editorStyles.calculationDate}>Дата расчёта<input aria-label="Дата таможенного расчёта" type="date" value={draft.customsCalculationDate||""} onChange={e=>change("customsCalculationDate",e.target.value)}/></label>','<CalculationDateControl value={draft.customsCalculationDate||""} onChange={value=>change("customsCalculationDate",value)} />')
text=replace(text,'<span className={editorStyles.dateHint}>Пусто — на сегодня</span>','<span className={editorStyles.dateHint}>{draft.customsCalculationDate ? <button type="button" className={editorStyles.todayButton} aria-label="Считать таможню на сегодня" onClick={()=>change("customsCalculationDate","")}>На сегодня</button> : "По умолчанию"}</span>')
text=replace(text,'<p className={editorStyles.note}>Месяц и день укажите, если они известны.</p>','<p className={editorStyles.note}>Вверху — выпуск авто по документам. Ниже — дата, на которую считаем его возраст.</p>')
p.write_text(text)
p,text=read_checked('apps/web/components/catalog/InlineParameterPanels.module.css','4f2bbf8c017d7c061f6def88bce3a9c4620f506c')
text+='''
/* Stable calendar affordance on Chromium/WebKit, including narrow mobile date controls. */
.dateFields .dateControl { position: relative; display: block; min-width: 0; height: 44px; margin-top: 6px; }
.dateFields .dateControl input { width: 100%; min-width: 0; height: 44px; margin: 0; padding: 0 42px 0 8px !important; appearance: none !important; -webkit-appearance: none !important; background-image: none !important; text-align: left; }
.dateControl input::-webkit-date-and-time-value { min-height: 1em; text-align: left; }
.dateControl input::-webkit-calendar-picker-indicator { position: absolute; right: 0; top: 0; width: 40px; height: 44px; margin: 0; padding: 0; opacity: 0; cursor: pointer; }
.dateControl input::-webkit-inner-spin-button { display: none; }
.dateFields .dateControl .calendarIcon { position: absolute; top: 13px; right: 12px; width: 18px; height: 18px; color: var(--ac-muted); pointer-events: none; }
.datePlaceholder { position: absolute; left: 8px; right: 42px; top: 0; height: 44px; display: flex; align-items: center; pointer-events: none; font-size: 16px; color: var(--ac-text); }
.dateControl[data-empty] input:not(:focus) { color: transparent !important; -webkit-text-fill-color: transparent !important; }
.dateControl:focus-within .datePlaceholder { visibility: hidden; }
.todayButton { min-height: 44px; max-width: 100%; padding: 4px; border: 0; border-radius: 8px; background: transparent; color: var(--ac-text); text-decoration: underline; cursor: pointer; }
.todayButton:focus-visible { outline: 2px solid var(--ac-public-accent); outline-offset: -2px; }
'''
p.write_text(text)
p,text=read_checked('apps/web/app/(public)/cars/offer/[id]/page.tsx','a96e21caf819c5bef7b94177949a9fa7a8668cdc')
text=replace(text,'<InlineOfferParameters autoCalculate=','<InlineOfferParameters sourcePriceOnly={sellerPricing || (selectionRequired && !selectedModification)} autoCalculate=');p.write_text(text)
p=Path('tests/browser/attached-parameters-fixture.tsx');text=p.read_text()
text=replace(text,"const initial =", "const isHybrid=kind==='hybrid'||kind==='missing-hybrid';\nconst initial =")
text=text.replace("kind==='hybrid'?","isHybrid?")
text=replace(text,"powerHp:'160'","powerHp:kind==='missing-hybrid'?'':'160'")
text=replace(text,'<InlineOfferParameters offerId=','<InlineOfferParameters sourcePriceOnly={kind===\'missing-hybrid\'} autoCalculate={kind===\'missing-hybrid\'} offerId=')
text=replace(text,'<span>Проверка интерфейса</span>',"<span>{kind==='missing-hybrid'?'Цена продавца':'Проверка интерфейса'}</span>")
p.write_text(text)
p=Path('tests/browser/attached-parameter-dropdowns.mjs');text=p.read_text()
text=replace(text,"const { chromium } =", "const { chromium, webkit } =")
text=replace(text,"['n1','/?kind=n1']];","['n1','/?kind=n1'],['missing-hybrid','/?kind=missing-hybrid']];")
text=replace(text,"const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});", "const browser=process.env.PARAMETER_BROWSER==='webkit' ? await webkit.launch({headless:true}) : await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});")
needle="     if(index===0){"
text=replace(text,needle,needle+'''
      const control=panel.locator('[data-calculation-date-control]');
      const icon=control.locator('[data-calculation-calendar]');
      assert.equal(await icon.count(),1);assert.ok(await icon.isVisible(),'calendar visible in every viewport');
      const cb=await control.boundingBox(),ib=await icon.boundingBox();
      assert.ok(cb.right===undefined); // Playwright boxes expose x/width, not DOMRect.right.
      assert.ok(Math.abs(cb.x+cb.width-ib.x-ib.width-12)<1,'calendar keeps 12px right inset');
      assert.equal(await control.locator('input').evaluate(e=>getComputedStyle(e).backgroundImage),'none','date input must not inherit a select arrow');
''')
needle="   if(!live)assert.deepEqual(errors,[]);"
extra='''   if(!live && kind==='missing-hybrid'){
    await page.keyboard.press('Escape');await triggers.nth(0).click();
    const date=grid.getByLabel('Дата таможенного расчёта',{exact:true});
    assert.equal(await date.inputValue(),'');
    assert.ok(await grid.locator('[data-calculation-date-control]').getByText('Сегодня',{exact:true}).isVisible());
    await date.fill('2026-09-24');await page.waitForTimeout(750);
    assert.equal(await grid.getByLabel('Год выпуска',{exact:true}).inputValue(),'2026','calculation date cannot overwrite production year');
    assert.equal(requests.length,0,'missing power must not produce a guessed quote');
    assert.ok(await page.locator('.ac-offer-price-panel').getByText('Цена продавца',{exact:true}).isVisible(),'seller price must remain labelled and visible');
    assert.match(await page.locator('[data-parameter-calculation-status]').innerText(),/Мощность/);
    assert.equal(await date.inputValue(),'2026-09-24','date is saved even though the quote is blocked by power');
    await grid.getByRole('button',{name:'Считать таможню на сегодня',exact:true}).click();
    assert.equal(await date.inputValue(),'','today clears the override, not fixes a stale date');
    await page.keyboard.press('Escape');await triggers.nth(3).click();
    await grid.getByRole('spinbutton',{name:'Мощность, л.с.',exact:true}).fill('150');await page.waitForTimeout(850);
    assert.equal(requests.at(-1)?.customsCalculationDate,'');
    assert.ok(await page.locator('.ac-offer-price-panel').getByText('По вашим параметрам',{exact:true}).isVisible());
    await page.getByRole('button',{name:'Вернуть исходные данные',exact:true}).click();await page.waitForTimeout(100);
    assert.ok(await page.locator('.ac-offer-price-panel').getByText('Цена продавца',{exact:true}).isVisible());
   }
'''
text=replace(text,needle,extra+needle)
p.write_text(text)
p=Path('roadmap.md');p.write_text('''## 2026-09-13 — Понятная дата расчёта и календарь на мобильных
- Дата выпуска и дата расчёта разъяснены отдельно. Пустая дата расчёта отображается как «Сегодня»; выбранную дату можно сбросить на сегодня.
- Собственная иконка календаря с фиксированным отступом, без стрелки select; native date input и ручной ввод сохранены.
- Когда исходная цена — цена продавца, незаполненная мощность больше не убирает её после изменения даты. Понятная подсказка указывает нужное поле; полный расчёт не подменяется предположением.
- Формулы, исходные характеристики, схема API, компактные колонки и межплиточный отступ не менялись. Проверки и статус публикации фиксируются в PR.

'''+p.read_text())
print('Applied guarded date/feedback UI edits only; calculation engine and validation rules unchanged.')
