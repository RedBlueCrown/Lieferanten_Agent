// User-assigned managed identity of the app. The Container App, the daily job
// and every role assignment use this one identity, so permissions exist before
// the first container starts (no role propagation race on first deploy).

param location string
param tags object
param name string

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: name
  location: location
  tags: tags
}

output id string = identity.id
output name string = identity.name
output principalId string = identity.properties.principalId
output clientId string = identity.properties.clientId
