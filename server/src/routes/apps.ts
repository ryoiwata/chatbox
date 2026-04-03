import { Router } from 'express'

const router = Router()

// GET /api/apps — returns approved app registrations
// M0-M2: hardcoded test-app until the AppRegistration table is seeded (M5+)
router.get('/', (_req, res) => {
  res.json([
    {
      id: 'test-app',
      name: 'Test App',
      url: '/apps/test-app',
      description: 'Protocol compliance test fixture',
      tools: [
        {
          name: 'dummy_action',
          description: 'A test tool that always succeeds',
          parameters: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Optional message' },
            },
          },
        },
      ],
      status: 'approved',
    },
  ])
})

export default router
