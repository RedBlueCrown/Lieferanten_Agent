// Azure AI Document Intelligence (Entra auth only) for reading contract PDFs.

param location string
param tags object
param name string
param appPrincipalId string
param logAnalyticsWorkspaceId string

var cognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: name
  location: location
  tags: tags
  kind: 'FormRecognizer'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: name
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
    }
  }
}

resource cognitiveServicesUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(account.id, appPrincipalId, cognitiveServicesUserRoleId)
  scope: account
  properties: {
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: account
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [
      {
        categoryGroup: 'audit'
        enabled: true
      }
    ]
  }
}

output name string = account.name
output endpoint string = account.properties.endpoint
