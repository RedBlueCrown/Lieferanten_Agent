// Azure Communication Services + Email Communication Service with an
// Azure-managed sender domain (DoNotReply@<guid>.azurecomm.net), all with
// data location Switzerland. Local (access key) auth is disabled; the app
// sends with its managed identity.

param tags object
param communicationServiceName string
param emailServiceName string
param dataLocation string = 'Switzerland'
param appPrincipalId string

// "Communication and Email Service Owner" is the built-in role Microsoft
// documents for sending e-mail with a Microsoft Entra identity (SMTP and
// REST/SDK). It is narrower than Contributor but still contains
// Microsoft.Communication/CommunicationServices/write, which the e-mail data
// plane checks. If sending ever fails with 401/403, assign "Contributor"
// (b24988ac-6180-42a0-ab88-20f7382dd24c) on this resource instead.
var emailServiceOwnerRoleId = '09976791-48a7-449e-bb21-39d1a415f350'

resource emailService 'Microsoft.Communication/emailServices@2025-09-01' = {
  name: emailServiceName
  location: 'global'
  tags: tags
  properties: {
    dataLocation: dataLocation
  }
}

resource managedDomain 'Microsoft.Communication/emailServices/domains@2025-09-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  tags: tags
  properties: {
    domainManagement: 'AzureManaged'
    userEngagementTracking: 'Disabled'
  }
}

resource communicationService 'Microsoft.Communication/communicationServices@2025-09-01' = {
  name: communicationServiceName
  location: 'global'
  tags: tags
  properties: {
    dataLocation: dataLocation
    linkedDomains: [
      managedDomain.id
    ]
    disableLocalAuth: true
  }
}

resource emailSender 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(communicationService.id, appPrincipalId, emailServiceOwnerRoleId)
  scope: communicationService
  properties: {
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', emailServiceOwnerRoleId)
  }
}

output name string = communicationService.name
output endpoint string = 'https://${communicationService.properties.hostName}'
output senderAddress string = 'DoNotReply@${managedDomain.properties.mailFromSenderDomain}'
