# Catalog V2 source slots

Каждый рынок имеет минимум пять независимых source slots. Source slot считается здоровым только после фактического получения и нормализации объявлений; успешный HTTP probe без объявлений не считается продуктивностью.

- Korea: Encar, K Car, KB ChaChaCha, Bobaedream, Autowini.
- China: Che168/Autohome export, Guazi, Uxin, Dongchedi, Autohome used.
- Japan: Goonet, TCV, BE FORWARD, Car From Japan, завершённые аукционные лоты/статистика.
- UAE: DubiCars, Dubizzle, CarSwitch, YallaMotor, BE FORWARD UAE.
- Europe: mobile.de, AutoScout24, OTOMOTO, AutoTrader UK, дополнительный европейский marketplace.
- Georgia: MyAuto, Auto.ge, AutoPapa, MyMarket, SS.ge.

Probe используется только как диагностика. Одна неудачная стартовая страница не отключает адаптер. Реальный fetch выполняется по каждому source slot с контролем курсора, повторов, количества нормализованных предложений и привязки фотографий.
