/** Synthetic scanner fixtures only; never inserted into production storage. */
export const GEEHY_SCAN_SAMPLES = Array.from({ length: 30 }, (_, index) => {
  const traceNo = `BT7124009010023-${index + 10}`;
  return {
    model: 'APM32F103RBT6', quantity: 960, traceNo, sourceNo: 'OPGD144429023',
    raw: `APM32F103RBT6/NYORY/LQFP64/801204300041/960/2436/${traceNo}/OPGD144429023`,
  };
});
