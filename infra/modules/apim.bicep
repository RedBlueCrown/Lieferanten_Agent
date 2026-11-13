// Optional: API Management (Consumption) in front of the API. Imports the
// OpenAPI description the app publishes at /api/openapi.json, so it can only
// be deployed once the real app image runs (see main.bicep).

param location string
param tags object
param name string
param publisherEmail string
param publisherName string
@description('Public base URL of the Container App, e.g. https://ca-api-xyz.<env>.switzerlandnorth.azurecontainerapps.io')
param appUrl string
param apiPath string = 'vertragsmanagement'

resource apim 'Microsoft.ApiManagement/service@2024-05-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Consumption'
    capacity: 0
  }
  properties: {
    publisherEmail: publisherEmail
    publisherName: publisherName
  }
}

resource api 'Microsoft.ApiManagement/service/apis@2024-05-01' = {
  parent: apim
  name: 'vertragsmanagement'
  properties: {
    displayName: 'Vertragsmanagement API'
    path: apiPath
    protocols: [
      'https'
    ]
    // The OpenAPI paths already start with /api, so the backend is the app root.
    serviceUrl: appUrl
    format: 'openapi+json-link'
    value: '${appUrl}/api/openapi.json'
    subscriptionRequired: true
  }
}

output name string = apim.name
output gatewayUrl string = apim.properties.gatewayUrl
output apiUrl string = '${apim.properties.gatewayUrl}/${apiPath}'
