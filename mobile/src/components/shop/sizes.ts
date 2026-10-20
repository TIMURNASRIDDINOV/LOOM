// The size guide of the web configurator (configurator.html, #sizeGuideBody):
// chest and length in cm, US and EU labels. Sizes outside the table (a cap's
// "One size") have no line.
const GUIDE: Record<string, { chest: string; length: string; us: string; eu: string }> = {
  XS: { chest: '86–89', length: '66', us: 'XS', eu: '42–44' },
  S: { chest: '90–94', length: '69', us: 'S', eu: '44–46' },
  M: { chest: '95–99', length: '71', us: 'M', eu: '48' },
  L: { chest: '100–104', length: '73', us: 'L', eu: '50' },
  XL: { chest: '105–110', length: '75', us: 'XL', eu: '52–54' },
  XXL: { chest: '111–116', length: '77', us: '2XL', eu: '56' },
  XXXL: { chest: '117–122', length: '79', us: '3XL', eu: '58–60' },
}

/** `100–104 sm · 73 sm · US L · EU 50`, or null for a size the guide does not know. */
export function sizeLine(size: string, cm: string): string | null {
  const g = GUIDE[size.toUpperCase()]
  return g ? `${g.chest} ${cm} · ${g.length} ${cm} · US ${g.us} · EU ${g.eu}` : null
}
