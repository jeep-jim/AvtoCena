import {additionalKoreanSpecifications} from "./korean-specification-vocabulary";
import {koreanSpecificationNotes} from "./korean-specification-notes";
// Presentation only: never rewrite source evidence or calculation inputs.
const words: Record<string,string> = {
 ...additionalKoreanSpecifications,
 '르노코리아(삼성)':'Renault Korea (Samsung)', 'KG모빌리티(쌍용)':'KGM (SsangYong)', '쉐보레(GM대우)':'Chevrolet (GM Daewoo)',
 '기아':'Kia','현대':'Hyundai','제네시스':'Genesis','벤츠':'Mercedes-Benz','아우디':'Audi','테슬라':'Tesla','볼보':'Volvo','미니':'MINI',
 '카니발':'Carnival','그랜저':'Grandeur','팰리세이드':'Palisade','캐스퍼':'Casper','쏘렌토':'Sorento','스타리아':'Staria','아반떼':'Avante','쏘나타':'Sonata','셀토스':'Seltos','아이오닉':'Ioniq','싼타페':'Santa Fe','스포티지':'Sportage','투싼':'Tucson','모하비':'Mohave','니로':'Niro','쿠퍼':'Cooper','레이':'Ray','모델':'Model',
 '프레스티지':'Prestige','시그니처':'Signature','노블레스':'Noblesse','모던':'Modern','캘리그래피':'Calligraphy','익스클루시브':'Exclusive','인스퍼레이션':'Inspiration','프리미엄 초이스':'Premium Choice','프리미엄':'Premium','트렌디':'Trendy','스마트':'Smart','롱레인지':'Long Range','르블랑':'Le Blanc','프리미어':'Premier','그래비티':'Gravity','에어':'Air','더 마스터':'The Master','스탠다드':'Standard','마스터즈':'Masters',
 '더 뉴':'Обновлённый','클래스':'Class','시리즈':'-я серия','터보':'Турбо',
 '오토':'Автоматическая','전륜':'Передний привод','후륜':'Задний привод','4륜':'Полный привод',
 '대형차':'Большой класс','준중형차':'Компактный класс','중형차':'Средний класс','소형차':'Малый класс','경차':'Микролитражный класс','스포츠카':'Спортивный автомобиль','승합차':'Микроавтобус / минивэн','화물차':'Грузовой автомобиль',
 '은회색':'Серебристо-серый','은Серый':'Серебристо-серый','쥐색':'Тёмно-серый','청색':'Синий','진주색':'Перламутровый','빨간색':'Красный','녹색':'Зелёный',
 'LPG(일반인 구입)':'LPG (разрешена покупка частным лицом)',
};
const ordered=Object.entries(words).sort((a,b)=>b[0].length-a[0].length);
export function translateKoreanSpecification(value:string) {
 if(Object.hasOwn(koreanSpecificationNotes,value))return koreanSpecificationNotes[value];
 let result=value.replace(/(\d+)세대/g,'$1-е поколение').replace(/(\d+)인승/g,'$1 мест').replace(/(\d+)도어/g,'$1 дв.');
 for(const [source,target] of ordered) {
  const escaped=source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  result=result.replace(new RegExp(`(?<![\\p{Script=Hangul}])${escaped}(?![\\p{Script=Hangul}])`, 'gu'), target);
 }
 return result;
}
