type PowerDisplayInput = {
  powertrainKind?: string;
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

export type CatalogPowerDisplay = {
  thirtyMinutePowerKw: number;
  thirtyMinuteLabel: string;
  utilizationPowerKw?: number;
  utilizationLabel?: string;
  motorPowersKw: number[];
  sourceLabel: string;
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
  const thirtyMinutePowerKw = summedMotors
    || explicitThirtyMinute
    || (["electric", "series_hybrid"].includes(kind) ? customsPower : undefined);

  if (!thirtyMinutePowerKw) return null;

  const utilizationPowerKw = positive(offer.utilizationPowerKw) || customsPower;
  const motorEquation = motorPowersKw.length > 1
    ? `${motorPowersKw.map(formatKw).join(" + ")} = ${formatKw(thirtyMinutePowerKw)} кВт`
    : `${formatKw(thirtyMinutePowerKw)} кВт`;
  const utilizationDiffers = utilizationPowerKw
    && Math.abs(utilizationPowerKw - thirtyMinutePowerKw) > 0.01;

  return {
    thirtyMinutePowerKw,
    thirtyMinuteLabel: `30 мин: ${motorEquation}`,
    utilizationPowerKw,
    utilizationLabel: utilizationDiffers
      ? `Для утиля: ${formatKw(utilizationPowerKw)} кВт`
      : undefined,
    motorPowersKw,
    sourceLabel: motorPowersKw.length > 1
      ? "Сумма максимальной 30-минутной мощности тяговых электромоторов"
      : "Максимальная 30-минутная мощность тягового электромотора",
  };
}
