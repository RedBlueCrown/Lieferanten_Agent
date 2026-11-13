// The one Container App that serves the API and the built web app (port 3000).
//
// Pilot: exactly one replica. AI job progress is streamed to the browser via
// SSE from process memory; scaling out needs a shared event bus first.

param location string
param tags object
param name string
param environmentId string
param identityId string
param registryServer string
param image string
param env array
@description('CIDR ranges allowed to reach the app. Empty = open to the internet.')
param allowedIpRanges array = []
param cpu string = '1.0'
param memory string = '2Gi'
param targetPort int = 3000

resource app 'Microsoft.App/containerApps@2025-01-01' = {
  name: name
  location: location
  // azd finds the deploy target through this tag.
  tags: union(tags, { 'azd-service-name': 'app' })
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
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
        ipSecurityRestrictions: [
          for (range, i) in allowedIpRanges: {
            name: 'allow-${i}'
            action: 'Allow'
            ipAddressRange: range
          }
        ]
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
          name: 'api'
          image: image
          env: env
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          probes: [
            {
              // Migrations run at start-up; allow up to ~2 minutes.
              type: 'Startup'
              httpGet: {
                path: '/api/health'
                port: targetPort
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 10
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/api/health'
                port: targetPort
              }
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/api/health'
                port: targetPort
              }
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output id string = app.id
output name string = app.name
output fqdn string = app.properties.configuration.ingress.fqdn
output url string = 'https://${app.properties.configuration.ingress.fqdn}'
