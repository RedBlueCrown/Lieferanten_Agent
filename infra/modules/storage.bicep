// Storage account for the audit archive. Entra auth only (shared keys off),
// no public blob access. Container "audit-archive" carries a container-level
// time-based retention (WORM) policy. The policy stays UNLOCKED in the pilot
// so it can still be shortened or removed; lock it for production (one-way).

param location string
param tags object
param name string
@allowed([
  'Standard_LRS'
  'Standard_ZRS'
  'Standard_GRS'
  'Standard_GZRS'
])
param skuName string = 'Standard_ZRS'
param auditContainerName string = 'audit-archive'
@minValue(1)
@maxValue(146000)
param auditRetentionDays int = 3650
param appPrincipalId string
param logAnalyticsWorkspaceId string

var blobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource account 'Microsoft.Storage/storageAccounts@2024-01-01' = {
  name: name
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: skuName
  }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    allowCrossTenantReplication: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2024-01-01' = {
  parent: account
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource auditContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: auditContainerName
  properties: {
    publicAccess: 'None'
  }
}

// The API writes one block blob per audit record, so append writes stay off.
resource auditRetention 'Microsoft.Storage/storageAccounts/blobServices/containers/immutabilityPolicies@2024-01-01' = {
  parent: auditContainer
  name: 'default'
  properties: {
    immutabilityPeriodSinceCreationInDays: auditRetentionDays
    allowProtectedAppendWrites: false
  }
}

resource blobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(auditContainer.id, appPrincipalId, blobDataContributorRoleId)
  scope: auditContainer
  properties: {
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributorRoleId)
  }
}

resource blobDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: blobService
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
      }
    ]
  }
}

output name string = account.name
output blobEndpoint string = account.properties.primaryEndpoints.blob
output auditContainerUrl string = '${account.properties.primaryEndpoints.blob}${auditContainer.name}'
