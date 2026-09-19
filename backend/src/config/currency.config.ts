import { registerAs } from '@nestjs/config';

export default registerAs('currency', () => ({
  defaultCurrency: process.env.DEFAULT_CURRENCY ?? 'YER',
  usdToYer: parseFloat(process.env.USD_TO_YER ?? '530'),
  usdToSar: parseFloat(process.env.USD_TO_SAR ?? '3.75'),
  sarToYer: parseFloat(process.env.SAR_TO_YER ?? '139'),
}));
