// Azure OpenAI account (Entra auth only) with one model deployment.
//
// Data residency: only the "Standard" (regional) deployment type processes
// prompts in the account's region. GlobalStandard and DataZoneStandard may
// process outside Switzerland. Check that the model/version/SKU is offered in
// the chosen region before deploying (see docs/azure-deployment.md).

param location string
param tags object
param name string
param deploymentName string
param modelName string
param modelVersion string
param skuName string = 'Standard'
@description('Capacity in units of 1,000 tokens per minute.')
param capacity int = 50
param appPrincipalId string
param logAnalyticsWorkspaceId string

var openAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: name
  location: location
  tags: tags
  kind: 'OpenAI'
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

resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: account
  name: deploymentName
  sku: {
    name: skuName
    capacity: capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: modelName
      version: modelVersion
    }
    versionUpgradeOption: 'OnceCurrentVersionExpired'
  }
}

resource openAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(account.id, appPrincipalId, openAiUserRoleId)
  scope: account
  properties: {
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openAiUserRoleId)
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
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

output name string = account.name
output endpoint string = account.properties.endpoint
output deploymentName string = deployment.name
output location string = account.location
