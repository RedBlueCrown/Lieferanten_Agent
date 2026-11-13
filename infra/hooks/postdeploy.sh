#!/bin/sh
# azd postdeploy hook (service "app").
# "azd deploy" only updates the Container App. This moves the daily
# Container Apps Job to the same image. Without the Azure CLI the job keeps
# its previous image until the next "azd provision", which aligns it again.
set -eu

if ! command -v az >/dev/null 2>&1; then
  echo "postdeploy: Azure CLI not found; the daily job is updated on the next 'azd provision'." >&2
  exit 0
fi
if ! az account show --output none 2>/dev/null; then
  echo "postdeploy: Azure CLI is not signed in ('az login'); the daily job is updated on the next 'azd provision'." >&2
  exit 0
fi

: "${AZURE_SUBSCRIPTION_ID:?missing}"
: "${AZURE_RESOURCE_GROUP:?missing}"
: "${SERVICE_APP_NAME:?missing}"
: "${AZURE_CONTAINER_APPS_JOB_NAME:?missing}"

# Install the containerapp extension on first use without prompting.
export AZURE_EXTENSION_USE_DYNAMIC_INSTALL=yes_without_prompt

image=$(az containerapp show \
  --subscription "$AZURE_SUBSCRIPTION_ID" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$SERVICE_APP_NAME" \
  --query "properties.template.containers[0].image" \
  --output tsv)

echo "postdeploy: updating job $AZURE_CONTAINER_APPS_JOB_NAME to $image"
az containerapp job update \
  --subscription "$AZURE_SUBSCRIPTION_ID" \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_CONTAINER_APPS_JOB_NAME" \
  --container-name daily \
  --image "$image" \
  --output none
