import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import { ulid } from 'ulid'
import { sql } from 'kysely'
import {
  servicePermissionContexts,
  type ServiceContexts,
  type PurchaseInboundScopes,
} from '@zerp/model'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedOrderListFixture } from '../fixtures/vou-orders.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { ManagementService } from '../../src/app/management.ts'
import { SessionService } from '../../src/app/session.ts'
import { loadConfig } from '../../src/platform/config.ts'
import {
  inspectServiceContextUpgrade,
  upgradeServiceContexts,
} from '../../src/app/service-context-upgrade.ts'

test('supported service context maintenance conserves all old facts and grants without granting customer access', async () => {
  await withWflDatabase(async (db) => {
    const bootstrap = new TargetBootstrapService(db),
      password = 'Aa9!' + randomBytes(24).toString('base64url'),
      username = 'scope-admin-' + ulid()
    await bootstrap.initializeAdministrators(
      [
        { username, displayName: '范围维护管理员', password },
        {
          username: 'scope-peer-' + ulid(),
          displayName: '范围维护备用管理员',
          password,
        },
      ],
      12,
    )
    const config = loadConfig({
      DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL!,
      APP_SESSION_COOKIE_SECURE: 'false',
    })
    const { principal } = await new SessionService(db, config).signin(
      username,
      password,
    )
    const f = await seedOrderListFixture(db, 0, [
      'service-contract',
      'service-acceptance',
    ])
    const management = new ManagementService(db, { passwordMinLength: 12 })
    for (const user of [f.submitter, f.reviewer, f.noQuery]) {
      const role = await management.getRole(user.roleId, principal)
      const old = Object.fromEntries(
        role.permissions
          .filter((p) => servicePermissionContexts(p.path).length)
          .map((p) => [
            p.id,
            servicePermissionContexts(p.path).filter(
              (value) =>
                ![
                  'CUSTOMER',
                  'CUSTOMER_CONTRACT',
                  'PRIOR_BB',
                  'PRIOR_BA',
                ].includes(value),
            ),
          ]),
      )
      await management.saveRole(
        {
          id: role.id,
          name: 'source-scope-' + ulid(),
          customerScope: role.customerScope,
          permissionIds: role.permissions.map((p) => p.id),
          purchaseInboundScopes:
            role.purchaseInboundScopes as PurchaseInboundScopes,
          serviceContexts: old as ServiceContexts,
          revision: role.revision,
        },
        principal,
        'source-scope-fixture',
      )
    }
    const originalRole = await management.getRole(f.submitter.roleId, principal)
    await sql`ALTER TABLE app_role_permissions DROP CONSTRAINT app_role_permissions_service_contexts_check, ADD CONSTRAINT app_role_permissions_service_contexts_check CHECK (service_contexts <@ ARRAY['OTHER_UNIT','SUPPLIER','SALES_PARTNER','PRIOR_AA','PRIOR_AD','CONTRACT','PRIOR_AB','PRIOR_AE','PRIOR_AH']::text[])`.execute(
      db,
    )
    const source = await inspectServiceContextUpgrade(db)
    assert.equal(source.layout, 'SOURCE')
    const input = {
      baseline: source.baseline,
      actorId: principal.user.id,
      sourceReleaseSha: 'a'.repeat(40),
      targetReleaseSha: 'b'.repeat(40),
    }
    await assert.rejects(
      upgradeServiceContexts(db, { ...input, actorId: f.submitter.userId }),
      /service_context_upgrade_operator_required/,
    )
    // Actual existing source facts drift through a normal domain command.
    await bootstrap.createE2EPrincipal(
      {
        ...f.submitter,
        userId: ulid(),
        roleId: ulid(),
        username: 'drift-' + ulid(),
      },
      false,
      ['/app/role/get'],
    )
    await assert.rejects(
      upgradeServiceContexts(db, input),
      /service_context_upgrade_baseline_changed/,
    )
    const current = await inspectServiceContextUpgrade(db)
    const result = await upgradeServiceContexts(db, {
      ...input,
      baseline: current.baseline,
    })
    assert.equal(result.upgraded, true)
    assert.equal(result.existingServiceContexts, 'PRESERVED')
    assert.equal(result.grants, current.grants)
    assert.equal((await inspectServiceContextUpgrade(db)).layout, 'CURRENT')
    assert.deepEqual(
      await management.getRole(f.submitter.roleId, principal),
      originalRole,
    )
    assert.ok(
      Object.values(originalRole.serviceContexts)
        .flat()
        .every(
          (value) =>
            !value.startsWith('CUSTOMER') &&
            !['PRIOR_BB', 'PRIOR_BA'].includes(value),
        ),
    )
    await assert.rejects(
      upgradeServiceContexts(db, { ...input, baseline: result.afterBaseline }),
      /service_context_upgrade_source_layout_required/,
    )
  })
})
