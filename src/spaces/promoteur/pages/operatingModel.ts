export type OperatingPeriod = 'jour' | 'mois' | 'an';
export type OperatingInputs = {
  period: OperatingPeriod;
  unitRevenue: string;
  occupancyPct: string;
  prudentOccupancyPct: string;
  prudentPriceCutPct: string;
  ancillaryRevenueYear: string;
  variableCostPerUnit: string;
  fixedCostsYear: string;
  maintenanceYear: string;
};
export type OperatingCase = { revenue: number; operatingSurplus: number; marginPct: number };
export type OperatingResult = { central: OperatingCase; prudent: OperatingCase; breakEvenOccupancyPct: number | null };

export const emptyOperatingInputs = (): OperatingInputs => ({
  period: 'jour', unitRevenue: '', occupancyPct: '', prudentOccupancyPct: '', prudentPriceCutPct: '',
  ancillaryRevenueYear: '', variableCostPerUnit: '', fixedCostsYear: '', maintenanceYear: '',
});

const number = (value: string, allowZero = true): number | null => {
  if (!value?.trim()) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0) ? parsed : null;
};

/** Modèle d'exploitation simplifié ; aucune valorisation immobilière n'en est déduite. */
export function calculateOperatingModel(unitsRaw: string, inputs: OperatingInputs): OperatingResult | null {
  const units = number(unitsRaw, false);
  const price = number(inputs.unitRevenue, false);
  const occupancy = number(inputs.occupancyPct);
  const prudentOccupancy = number(inputs.prudentOccupancyPct);
  const cut = number(inputs.prudentPriceCutPct);
  const ancillary = number(inputs.ancillaryRevenueYear);
  const variableCost = number(inputs.variableCostPerUnit);
  const fixed = number(inputs.fixedCostsYear);
  const maintenance = number(inputs.maintenanceYear);
  if (units == null || !Number.isInteger(units) || price == null || occupancy == null || prudentOccupancy == null || cut == null
    || ancillary == null || variableCost == null || fixed == null || maintenance == null
    || occupancy > 100 || prudentOccupancy > occupancy || cut > 100) return null;
  const periods = inputs.period === 'jour' ? 365 : inputs.period === 'mois' ? 12 : 1;
  const annualCapacity = units * periods;
  const calculate = (occupancyRate: number, priceMultiplier: number): OperatingCase => {
    const occupied = annualCapacity * occupancyRate / 100;
    const revenue = occupied * price * priceMultiplier + ancillary;
    const operatingSurplus = revenue - occupied * variableCost - fixed - maintenance;
    return { revenue, operatingSurplus, marginPct: revenue > 0 ? operatingSurplus / revenue * 100 : 0 };
  };
  const contribution = price * (1 - cut / 100) - variableCost;
  const breakEvenOccupancyPct = contribution > 0 ? (fixed + maintenance - ancillary) / (annualCapacity * contribution) * 100 : null;
  return { central: calculate(occupancy, 1), prudent: calculate(prudentOccupancy, 1 - cut / 100), breakEvenOccupancyPct };
}
