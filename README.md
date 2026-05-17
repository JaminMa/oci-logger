# oci-logger

A lightweight Node.js/TypeScript API gateway that ingests log events from web applications and forwards them to [Oracle Cloud Infrastructure (OCI) Logging](https://docs.oracle.com/en-us/iaas/Content/Logging/home.htm). Designed to run on an OCI compute instance.

## Features

- **Simple REST API** — POST log events to a single `/logs` endpoint
- **Multi-app support** — Route logs to different OCI Log resources using named `logName` keys
- **Dual authentication** — Supports both OCI Instance Principals (production) and local config file (development)
- **Rate limiting** — Configurable per-IP request throttling via `express-rate-limit`
- **CORS allowlisting** — Restrict inbound requests to trusted origins
- **Health check** — `GET /health` endpoint for uptime monitoring

## Prerequisites

- Node.js 18+
- An OCI tenancy with the [Logging service](https://docs.oracle.com/en-us/iaas/Content/Logging/home.htm) enabled
- At least one OCI Log resource created and its OCID available
- For local development: a configured `~/.oci/config` file

## Getting Started

### 1. Clone the repo

```bash
git clone git@github.com:JaminMa/oci-logger.git
cd oci-logger
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|---|---|---|
| `PORT` | Port the service listens on | `3000` |
| `USE_INSTANCE_PRINCIPAL` | Use OCI Instance Principal auth (`true`) or local config file (`false`) | `false` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in milliseconds | `900000` (15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per IP per window | `100` |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins (`*` for all) | `*` |
| `LOG_OCID_<LogName>` | OCI Log OCID mapped to a log name (see below) | — |

### 4. Map log names to OCI Log OCIDs

For each OCI Log resource you want to write to, add an entry to your `.env` in the format `LOG_OCID_<LogName>=<ocid>`:

```env
LOG_OCID_AppErrors=ocid1.log.oc1.iad.amaaaa...
LOG_OCID_UserEvents=ocid1.log.oc1.iad.amaaaa...
```

The `<LogName>` portion is what callers will pass as the `logName` field in their POST request body.

### 5. Run the service

**Development** (uses `ts-node`, local OCI config file auth):
```bash
npm run dev
```

**Production** (compile first, then run):
```bash
npm run build
npm start
```

## API Reference

### `GET /health`

Returns a simple liveness check.

**Response `200 OK`:**
```json
{ "status": "OK" }
```

---

### `POST /logs`

Ingests a log event and forwards it to OCI Logging.

**Request body:**
```json
{
  "logName": "AppErrors",
  "logData": { "message": "Something went wrong", "userId": 42 }
}
```

| Field | Type | Description |
|---|---|---|
| `logName` | `string` | Key used to look up the target OCI Log OCID (`LOG_OCID_<logName>`) |
| `logData` | `string \| object` | Arbitrary log payload. Objects are JSON-serialized automatically. |

**Response `200 OK`:**
```json
{ "message": "Log sent successfully" }
```

**Error responses:**

| Status | Reason |
|---|---|
| `400` | Missing `logName` or `logData`, or no OCID configured for the given `logName` |
| `429` | Rate limit exceeded |
| `500` | OCI client failed to initialize at startup, or unexpected error forwarding logs to OCI |

## Authentication

### Local development

Set `USE_INSTANCE_PRINCIPAL=false` (the default). The service will use your `~/.oci/config` file. See the [OCI SDK configuration guide](https://docs.oracle.com/en-us/iaas/Content/API/Concepts/sdkconfig.htm) for setup instructions.

### Production (OCI compute instance)

Set `USE_INSTANCE_PRINCIPAL=true`. The service will authenticate using the [Instance Principal](https://docs.oracle.com/en-us/iaas/Content/Identity/Tasks/callingservicesfrominstances.htm) attached to the compute instance — no credentials need to be stored on disk.

Make sure the instance's **dynamic group** has a policy granting `manage log-content` on the relevant log resources.
