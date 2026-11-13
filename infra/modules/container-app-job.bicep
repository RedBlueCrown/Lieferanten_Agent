// Container Apps Job for the daily deadline run (schedule trigger, UTC).
// Same image, environment variables and identity as the app.

param location string
param tags object
param name string
param environmentId string
param identityId string
param registryServer string
param image string
param env array
@description('Cron expression, evaluated in UTC.')
param cronExpression string = '0 5 * * *'
param command array = [
  'node'
  'apps/api/dist/jobs/daily.mjs'
]
param cpu string = '0.5'
param memory string = '1Gi'

resource job 'Microsoft.App/jobs@2025-01-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 1800
      replicaRetryLimit: 1
      scheduleTriggerConfig: {
        cronExpression: cronExpression
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: registryServer
          identity: identityId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'daily'
          image: image
          command: command
          env: env
          resources: {
            cpu: json(cpu)
            memory: memory
          }
        }
      ]
    }
  }
}

output id string = job.id
output name string = job.name
