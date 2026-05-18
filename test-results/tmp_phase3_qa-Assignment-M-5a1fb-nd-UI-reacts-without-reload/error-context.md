# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tmp_phase3_qa.spec.ts >> Assignment Management Phase 3 UI QA >> Admin can reassign, add support, view history, and UI reacts without reload
- Location: tmp_phase3_qa.spec.ts:62:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByLabel('Correo')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e4]: "[plugin:vite:css] The requested module './logger.js' does not provide an export named 'z'"
  - generic [ref=e5]: C:/Users/Admin/Teleasistencia2026/teleasistencia/src/styles/index.css
  - generic [ref=e6]: "at #asyncInstantiate (node:internal/modules/esm/module_job:302:21) at async ModuleJob.run (node:internal/modules/esm/module_job:405:5) at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:660:26) at async compilePostCSS (file:///C:/Users/Admin/Teleasistencia2026/teleasistencia/node_modules/vite/dist/node/chunks/node.js:20934:48) at async compileCSS (file:///C:/Users/Admin/Teleasistencia2026/teleasistencia/node_modules/vite/dist/node/chunks/node.js:20912:26) at async TransformPluginContext.handler (file:///C:/Users/Admin/Teleasistencia2026/teleasistencia/node_modules/vite/dist/node/chunks/node.js:20428:47) at async EnvironmentPluginContainer.transform (file:///C:/Users/Admin/Teleasistencia2026/teleasistencia/node_modules/vite/dist/node/chunks/node.js:30128:14) at async loadAndTransform (file:///C:/Users/Admin/Teleasistencia2026/teleasistencia/node_modules/vite/dist/node/chunks/node.js:24459:26)"
  - generic [ref=e7]:
    - text: Click outside, press Esc key, or fix the code to dismiss.
    - text: You can also disable this overlay by setting
    - code [ref=e8]: server.hmr.overlay
    - text: to
    - code [ref=e9]: "false"
    - text: in
    - code [ref=e10]: vite.config.ts
    - text: .
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test'
  2   | 
  3   | const baseURL = 'http://127.0.0.1:4173'
  4   | const password = 'Phase3QA!20260515113208'
  5   | 
  6   | const users = {
  7   |   admin: {
  8   |     email: 'qa.phase3.admin.20260515113208@mistatas.com',
  9   |     homePath: '/admin/inicio',
  10  |     fullName: 'QA Phase3 Admin',
  11  |   },
  12  |   superAdmin: {
  13  |     email: 'qa.phase3.super.20260515113208@mistatas.com',
  14  |     homePath: '/super-admin/inicio',
  15  |     fullName: 'QA Phase3 Super Admin',
  16  |   },
  17  |   tele1: {
  18  |     email: 'qa.phase3.tele1.20260515113208@mistatas.com',
  19  |     homePath: '/teleoperadora/inicio',
  20  |     fullName: 'QA Phase3 Tele 1',
  21  |   },
  22  |   tele2: {
  23  |     email: 'qa.phase3.tele2.20260515113208@mistatas.com',
  24  |     homePath: '/teleoperadora/inicio',
  25  |     fullName: 'QA Phase3 Tele 2',
  26  |   },
  27  |   tele3: {
  28  |     email: 'qa.phase3.tele3.20260515113208@mistatas.com',
  29  |     homePath: '/teleoperadora/inicio',
  30  |     fullName: 'QA Phase3 Tele 3',
  31  |   },
  32  | } as const
  33  | 
  34  | const beneficiaries = {
  35  |   b1: {
  36  |     id: '1ac1ae3c-911b-4191-97d9-c85dae04b4ca',
  37  |     name: 'Beneficiario QA Uno',
  38  |   },
  39  |   b2: {
  40  |     id: '253679cc-e301-4237-ae36-c9185100f0db',
  41  |     name: 'Beneficiario QA Dos',
  42  |   },
  43  | } as const
  44  | 
  45  | async function signIn(page: import('@playwright/test').Page, email: string, expectedPath: string) {
  46  |   await page.goto(`${baseURL}/login`)
> 47  |   await page.getByLabel('Correo').fill(email)
      |                                   ^ Error: locator.fill: Test timeout of 30000ms exceeded.
  48  |   await page.getByLabel('Contrasena').fill(password)
  49  |   await page.getByRole('button', { name: 'Entrar al espacio de trabajo' }).click()
  50  |   await page.waitForURL((url) => url.pathname === expectedPath, { timeout: 30000 })
  51  | }
  52  | 
  53  | function dialogByTitle(page: import('@playwright/test').Page, title: string) {
  54  |   return page.locator('div.fixed').filter({ has: page.getByRole('heading', { name: title }) })
  55  | }
  56  | 
  57  | function beneficiaryCard(page: import('@playwright/test').Page, beneficiaryName: string) {
  58  |   return page.locator('div').filter({ hasText: beneficiaryName }).filter({ hasText: 'Beneficiario asignado' }).first()
  59  | }
  60  | 
  61  | test.describe.serial('Assignment Management Phase 3 UI QA', () => {
  62  |   test('Admin can reassign, add support, view history, and UI reacts without reload', async ({ page }) => {
  63  |     await signIn(page, users.admin.email, users.admin.homePath)
  64  |     await page.goto(`${baseURL}/assignments`)
  65  |     await expect(page.getByRole('heading', { name: 'Gestión controlada de responsables y apoyos temporales' })).toBeVisible()
  66  | 
  67  |     await page.getByRole('button', { name: 'Vista por teleoperadora' }).click()
  68  |     await page.getByLabel('Responsable operacional').selectOption({ label: users.tele1.fullName })
  69  |     await expect(page.getByText(beneficiaries.b1.name)).toBeVisible()
  70  | 
  71  |     await beneficiaryCard(page, beneficiaries.b1.name).getByRole('button', { name: 'Cambiar responsable' }).click()
  72  |     const changeDialog = dialogByTitle(page, 'Cambiar responsable')
  73  |     await expect(changeDialog.getByRole('button', { name: 'Confirmar cambio' })).toBeDisabled()
  74  |     await expect(changeDialog.locator('option').filter({ hasText: users.tele1.fullName })).toHaveCount(0)
  75  |     await changeDialog.getByLabel('Nuevo responsable').selectOption({ label: users.tele2.fullName })
  76  |     await changeDialog.getByLabel('Motivo del cambio').fill('QA admin reasigna B1 hacia Tele2')
  77  |     await changeDialog.getByRole('button', { name: 'Confirmar cambio' }).click()
  78  | 
  79  |     await expect(page.getByText('Responsable actualizada')).toBeVisible()
  80  |     await expect(page.getByText(`${users.tele1.fullName} -> ${users.tele2.fullName}`)).toBeVisible()
  81  |     await expect(page.getByLabel('Responsable operacional')).toHaveValue(/6781075d-3513-4fa2-b0c2-cd98f45a0b80/)
  82  | 
  83  |     await page.getByLabel('Buscar beneficiario').fill(beneficiaries.b1.name)
  84  |     await beneficiaryCard(page, beneficiaries.b1.name).getByRole('button', { name: 'Agregar apoyo temporal' }).click()
  85  |     const supportDialog = dialogByTitle(page, 'Agregar apoyo temporal')
  86  |     await expect(supportDialog.getByRole('button', { name: 'Confirmar apoyo temporal' })).toBeDisabled()
  87  |     await expect(supportDialog.locator('option').filter({ hasText: users.tele2.fullName })).toHaveCount(0)
  88  |     await supportDialog.getByLabel('Teleoperadora de apoyo').selectOption({ label: users.tele3.fullName })
  89  |     await supportDialog.getByLabel('Motivo del apoyo').fill('QA admin agrega apoyo temporal a B1')
  90  |     await supportDialog.getByRole('button', { name: 'Confirmar apoyo temporal' }).click()
  91  | 
  92  |     await expect(page.getByText('Apoyo temporal agregado')).toBeVisible()
  93  |     await expect(page.getByText(users.tele3.fullName)).toBeVisible()
  94  | 
  95  |     await beneficiaryCard(page, beneficiaries.b1.name).getByRole('button', { name: 'Ver historial' }).click()
  96  |     const historyDialog = dialogByTitle(page, beneficiaries.b1.name)
  97  |     await expect(historyDialog.getByText('QA admin reasigna B1 hacia Tele2')).toBeVisible()
  98  |     await expect(historyDialog.getByText('QA admin agrega apoyo temporal a B1')).toBeVisible()
  99  |     await historyDialog.getByRole('button', { name: 'Cerrar' }).click()
  100 |   })
  101 | 
  102 |   test('Teleoperadora support view is isolated and admin URL is blocked', async ({ page }) => {
  103 |     await signIn(page, users.tele3.email, users.tele3.homePath)
  104 |     await page.goto(`${baseURL}/teleoperadora/cartera`)
  105 | 
  106 |     await expect(page.getByText(beneficiaries.b1.name)).toBeVisible()
  107 |     await expect(page.getByText('Apoyo temporal')).toBeVisible()
  108 |     await expect(page.getByText(`Responsable oficial: ${users.tele2.fullName}`)).toBeVisible()
  109 |     await expect(page.getByRole('button', { name: 'Cambiar responsable' })).toHaveCount(0)
  110 |     await expect(page.getByRole('button', { name: 'Agregar apoyo temporal' })).toHaveCount(0)
  111 |     await expect(page.getByRole('button', { name: 'Finalizar apoyo' })).toHaveCount(0)
  112 | 
  113 |     await page.goto(`${baseURL}/assignments`)
  114 |     await page.waitForURL((url) => url.pathname === '/unauthorized', { timeout: 30000 })
  115 |   })
  116 | 
  117 |   test('Teleoperadora without ownership cannot open beneficiary by direct URL', async ({ page }) => {
  118 |     await signIn(page, users.tele1.email, users.tele1.homePath)
  119 |     await page.goto(`${baseURL}/teleoperadora/cartera`)
  120 |     await expect(page.getByText(beneficiaries.b1.name)).toHaveCount(0)
  121 | 
  122 |     await page.goto(`${baseURL}/teleoperadora/beneficiarios/${beneficiaries.b1.id}`)
  123 |     await expect(page.getByRole('heading', { name: 'No fue posible abrir la ficha' })).toBeVisible()
  124 |     await expect(page.getByText('La cartera activa no contiene este beneficiario.')).toBeVisible()
  125 |   })
  126 | 
  127 |   test('Admin can close support and preserve history', async ({ page }) => {
  128 |     await signIn(page, users.admin.email, users.admin.homePath)
  129 |     await page.goto(`${baseURL}/assignments`)
  130 |     await page.getByRole('button', { name: 'Vista por teleoperadora' }).click()
  131 |     await page.getByLabel('Responsable operacional').selectOption({ label: users.tele3.fullName })
  132 |     await page.getByLabel('Buscar beneficiario').fill(beneficiaries.b1.name)
  133 | 
  134 |     await beneficiaryCard(page, beneficiaries.b1.name).getByRole('button', { name: 'Finalizar apoyo' }).click()
  135 |     const closeDialog = dialogByTitle(page, 'Finalizar apoyo temporal')
  136 |     await expect(closeDialog.getByRole('button', { name: 'Confirmar cierre' })).toBeDisabled()
  137 |     await closeDialog.getByLabel('Motivo de cierre').fill('QA admin cierra apoyo temporal B1')
  138 |     await closeDialog.getByRole('button', { name: 'Confirmar cierre' }).click()
  139 | 
  140 |     await expect(page.getByText('Apoyo temporal cerrado')).toBeVisible()
  141 |     await page.getByLabel('Responsable operacional').selectOption({ label: users.tele2.fullName })
  142 |     await page.getByLabel('Buscar beneficiario').fill(beneficiaries.b1.name)
  143 |     await beneficiaryCard(page, beneficiaries.b1.name).getByRole('button', { name: 'Ver historial' }).click()
  144 |     const historyDialog = dialogByTitle(page, beneficiaries.b1.name)
  145 |     await expect(historyDialog.getByText('QA admin cierra apoyo temporal B1')).toBeVisible()
  146 |   })
  147 | 
```