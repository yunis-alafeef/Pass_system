import { registerAs } from '@nestjs/config';

export default registerAs('payment', () => ({
  defaultCurrency: process.env.DEFAULT_CURRENCY ?? 'YER',
  successRate: parseFloat(process.env.PAYMENT_SUCCESS_RATE ?? '1'),
  timeoutMs: parseInt(process.env.PAYMENT_TIMEOUT_MS ?? '30000', 10),
  kureimi: {
    baseUrl: process.env.KUREIMI_BASE_URL ?? '',
    merchantId: process.env.KUREIMI_MERCHANT_ID ?? '',
    apiKey: process.env.KUREIMI_API_KEY ?? '',
    secret: process.env.KUREIMI_SECRET ?? '',
    webhookSecret: process.env.KUREIMI_WEBHOOK_SECRET ?? '',
  },
  tadamon: {
    baseUrl: process.env.TADAMON_BASE_URL ?? '',
    merchantId: process.env.TADAMON_MERCHANT_ID ?? '',
    apiKey: process.env.TADAMON_API_KEY ?? '',
    secret: process.env.TADAMON_SECRET ?? '',
  },
  jawwal: {
    baseUrl: process.env.JAWWAL_BASE_URL ?? '',
    merchantId: process.env.JAWWAL_MERCHANT_ID ?? '',
    apiKey: process.env.JAWWAL_API_KEY ?? '',
    secret: process.env.JAWWAL_SECRET ?? '',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  },
}));
