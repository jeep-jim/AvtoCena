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
  const customsPower = positive(offer.calculationSnapshot?.customs?.utilizationPowerKw);
  const snapshotPreviewPower = positive(offer.calculationSnapshot?.utilizationPowerPreviewKw);
  const storedUtilizationPower = positive(offer.utilizationPowerKw);
  // Public 30-minute power is shown ONLY when the exact 30-minute value exists.
  // Peak motor power, hp->kW conversion and preliminary utilization previews must never
  // masquerade as 30-minute power. Preliminary cards simply omit this tile.
  const thirtyMinutePowerKw = summedMotors || explicitThirtyMinute;

  if (!thirtyMinutePowerKw) return null;

  const estimated = false;
  const utilizationPowerKw = storedUtilizationPower || customsPower || snapshotPreviewPower;
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
    estimated,
  };
}
