# Performance Hub

Build a professional Arabic RTL web app called “Marketers Performance Hub” for managing affiliate marketers, ad spend, orders, products, and campaign performance.

Use a clean light theme, modern dashboard design, cards, tables, filters, charts, and responsive layout.

The app should use Supabase as backend and authentication.

User roles:

1. Admin: can view and manage everything.

2. Account Manager: can add marketers, upload orders, add ad spend transactions.

3. Marketer: can only see their own performance dashboard and orders.

Main pages:

1. Login page

2. Admin Dashboard

3. Marketers Management

4. Marketer Details Page

5. Orders Import Page

6. Orders Table

7. Ad Spend / Wallet Page

8. Products Performance

9. Shipping Companies Performance

10. Settings / Column Mapping

Database tables needed:

- profiles

- marketers

- orders

- products

- ad_spend_transactions

- import_batches

- column_mappings

- ad_accounts

- shipping_companies

Order statuses:

Pending = طلب جديد

In Delivery = في الشحن

REFUNDED = رجع المخزن

REFUND_REQUEST = مرتجع مع شركة الشحن

DELIVERED = تم التسليم

Done = تم التحصيل

Orders will be uploaded daily from Excel or CSV. Build an upload/import flow where the user can map uploaded columns to system fields, so if column order changes, the import still works.

Important calculations:

- Total Orders

- Pending Orders

- In Delivery Orders

- Delivered Orders

- Refunded Orders

- Refund Request Orders

- Done Orders

- Gross Profit = sum of Commission column

- Ad Spend = sum of ad_spend_transactions amount

- Net Profit = Gross Profit - Ad Spend

- Delivery Rate = Delivered / Total Orders

- Refund Rate = Refunded + Refund Request / Total Orders

- Marketer performance by date range

- Product performance by date range

- Shipping company performance by date range

Ad spend transaction fields:

- marketer_id

- amount

- fawry_code

- transaction_date

- notes

- created_by

Marketer fields:

- marketer_code

- name

- phone

- whatsapp

- email

- facebook_profile

- tiktok_profile

- status

- account_manager

- notes

Future integrations:

Prepare structure for connecting Meta Ads and TikTok Ads accounts later, but do not implement API connection now. Add placeholder pages and database fields for platform, ad_account_id, access_status, last_sync_at.

Design requirements:

- Arabic RTL

- Light colors

- Easy navigation sidebar

- Clear filters: date range, marketer, product, order status, shipping company

- Beautiful charts and KPI cards

- Tables with search, sorting, export

- Marketer profile page should show full performance details

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://marketer-shine-hub.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e2b7f922-dcb1-4cbf-8081-3bf55ca67e0b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
