// Event Grid custom topic (CloudEvents 1.0, Entra auth only). Third-party
// systems subscribe to it; the app publishes with "EventGrid Data Sender".

param location string
param tags object
param name string
param appPrincipalId string

var dataSenderRoleId = 'd5a91429-5739-47e2-a06b-3470a27159e7'

resource topic 'Microsoft.EventGrid/topics@2025-02-15' = {
  name: name
  location: location
  tags: tags
  properties: {
    inputSchema: 'CloudEventSchemaV1_0'
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    minimumTlsVersionAllowed: '1.2'
  }
}

resource dataSender 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(topic.id, appPrincipalId, dataSenderRoleId)
  scope: topic
  properties: {
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', dataSenderRoleId)
  }
}

output name string = topic.name
output endpoint string = topic.properties.endpoint
