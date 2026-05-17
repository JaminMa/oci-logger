import express, { Request, Response } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import * as dotenv from 'dotenv';
import * as oci from 'oci-common';
import * as loggingingestion from 'oci-loggingingestion';
import crypto from 'crypto';

dotenv.config();

async function main() {
  const app = express();
  const port = process.env.PORT || 3000;

  // Parse JSON bodies
  app.use(express.json());

  // CORS Configuration
  const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*'];
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf('*') !== -1 || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  }));

  // Rate Limiting
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10); // 15 minutes default
  const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);
  const limiter = rateLimit({
    windowMs,
    max: maxRequests,
    message: { error: 'Too many requests from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/logs', limiter);

  // OCI Configuration — InstancePrincipal builder is async, so we await it here
  let loggingClient: loggingingestion.LoggingClient | null = null;
  try {
    let provider: oci.AuthenticationDetailsProvider;
    if (process.env.USE_INSTANCE_PRINCIPAL === 'true') {
      console.log('Using Instance Principal for OCI authentication');
      provider = await new oci.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
    } else {
      console.log('Using local config file for OCI authentication');
      provider = new oci.ConfigFileAuthenticationDetailsProvider();
    }
    loggingClient = new loggingingestion.LoggingClient({ authenticationDetailsProvider: provider });
  } catch (err) {
    console.warn('WARNING: Failed to initialize OCI provider. Service will start but logging will fail.', err);
    // loggingClient remains null — /logs endpoint will return 500
  }

  // Health check endpoint
  app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'OK' });
  });

  // Logging endpoint
  app.post('/logs', async (req: Request, res: Response) => {
    try {
      const { logName, logData } = req.body;

      if (!logName || !logData) {
        return res.status(400).json({ error: 'Missing required fields: logName and logData' });
      }

      // Look up the OCID for the given logName
      const logOcid = process.env[`LOG_OCID_${logName}`];

      if (!logOcid) {
        return res.status(400).json({ error: `No Log OCID configured for logName: ${logName}` });
      }

      // Construct the log payload
      const putLogsDetails: loggingingestion.models.PutLogsDetails = {
        specversion: "1.0",
        logEntryBatches: [
          {
            entries: [
              {
                data: typeof logData === 'string' ? logData : JSON.stringify(logData),
                id: crypto.randomUUID(),
                time: new Date()
              }
            ],
            source: `oci-logger-service-${logName}`,
            type: "application",
            "defaultlogentrytime": new Date()
          }
        ]
      };

      const request: loggingingestion.requests.PutLogsRequest = {
        logId: logOcid,
        putLogsDetails: putLogsDetails
      };

      // Send logs to OCI
      if (!loggingClient) {
        return res.status(500).json({ error: 'OCI logging client not initialized. Check server configuration.' });
      }
      await loggingClient.putLogs(request);

      return res.status(200).json({ message: 'Log sent successfully' });
    } catch (error: any) {
      console.error('Error sending logs to OCI:', error);
      return res.status(500).json({ error: 'Failed to send logs to OCI', details: error.message });
    }
  });

  // Start the server
  app.listen(port, () => {
    console.log(`OCI Logger service is running on port ${port}`);
  });
}

main().catch(err => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
