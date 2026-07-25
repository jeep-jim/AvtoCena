type PowerDisplayInput = {
  powertrainKind?: string;
  fuel?: string;
  powerHp?: number;
  powerKw?: number;
  power30MinKw?: number;
  power30MinKwByMotor?: number[];
  utilizationPowerKw?: number;
  calculationSnapshot?: any;
};

function positive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : undefined;
}

function formatKw(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

function isElectricOrHybrid(offer: PowerDisplayInput) {
  const kind = String(offer.powertrainKind || "").toLowerCase();
  const fuel = String(offer.fuel || "").toLowerCase();
  return ["electric", "series_hybrid", "other_hybrid"].includes(kind)
    || /electric|электро|hybrid|гибрид|bev|phev|hev/.test(fuel);
}

export type CatalogPowerDisplay = {
  thirtyMinutePowerKw: number;
  thirtyMinuteLabel: string;
  utilizationPowerKw?: number;
  utilizationLabel?: string;
  motorPowersKw: number[];
  sourceLabel: string;
  estimated: boolean;
};

export function catalogPowerDisplay(offer: PowerDisplayInput): CatalogPowerDisplay | null {
  const motorPowersKw = (offer.power30MinKwByMotor || [])
    .map(positive)
    .filter((value): value is number => value !== undefined);
  const summedMotors = motorPowersKw.length
    ? Math.round(motorPowersKw.reduce((sum, value) => sum + value, 0) * 100) / 100
    : undefined;
  const explicitThirtyMinute = positive(offer.power30MinKw);
  const kind = String(offer.powertrainKind || "").toLowerCase();
  const customsPower = positive(offer.calculationSnapshot?.customs?.utilizationPowerKw);
  const storedUtilizationPower = positive(offer.utilizationPowerKw);
  const peakPowerKw = positive(offer.powerKw)
    || (positive(offer.powerHp) ? Math.round((Number(offer.powerHp) / 1.35962) * 100) / 100 : undefined);
  const legacyEstimate = isElectricOrHybrid(offer)
    ? storedUtilizationPower || peakPowerKw
    : undefined;
  const certifiedMissing = Boolean(offer.calculationSnapshot?.certified30MinutePowerMissing);
  const thirtyMinutePowerKw = summedMotors
    || explicitThirtyMinute
    || (["electric", "series_hybrid"].includes(kind) ? customsPower : undefined)
    || legacyEstimate;

  if (!thirtyMinutePowerKw) return null;

  const exactAvailable = Boolean(summedMotors || explicitThirtyMinute);
  const estimated = !exactAvailable && (certifiedMissing || Boolean(legacyEstimate));
  const utilizationPowerKw = storedUtilizationPower || customsPower || (estimated ? thirtyMinutePowerKw : undefined);
  const motorEquation = motorPowersKw.length > 1
    ? `${motorPowersKw.map(formatKw).join(" + ")} = ${formatKw(thirtyMinutePowerKw)} кВт`
    : `${formatKw(thirtyMinutePowerKw)} кВт`;
  const utilizationDiffers = utilizationPowerKw
    && Math.abs(utilizationPowerKw - thirtyMinutePowerKw) > 0.01;

  return {
    thirtyMinutePowerKw,
    thirtyMinuteLabel: estimated
      ? `Расчёт: ${formatKw(thirtyMinutePowerKw)} кВт`
      : `30 мин: ${motorEquation}`,
    utilizationPowerKw,
    utilizationLabel: utilizationDiffers
      ? `Для утиля: ${formatKw(utilizationPowerKw)} кВт`
      : undefined,
    motorPowersKw,
    sourceLabel: estimated
      ? "Для предварительного расчёта использована доступная мощность электромотора. Точная 30-минутная мощность будет подтверждена по документам автомобиля."
      : motorPowersKw.length > 1
        ? "Сумма максимальной 30-минутной мощности тяговых электромоторов"
        : "Максимальная 30-минутная мощность тягового электромотора",
    estimated,
  };
}
