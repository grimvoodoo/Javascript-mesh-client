import axios from "axios";
import zlib from "zlib";
import log from "loglevel";
import generateHeaders from "../headers/generate_headers.js";

/**
 * @namespace sendChunkedMessage
 */

/**
 * This const sets the size of each chunk in bytes. This constant sets the maximum amount of data (in bytes)
 * that each chunk can contain when sending a message in chunked form. It is calculated by taking a value and
 * multiplying it by 1024 to convert it to kilobytes (KB), it then multiples it again by 1024 to convert it
 * to megabytes (MB).
 * For example, 10 * 1024 * 1024 sets the chunk size to 10 MB.
 * @memberof sendChunkedMessage
 */
const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Compresses provided data using gzip compression.
 *
 * @memberof sendChunkedMessage
 * @function compressData
 * @param {Buffer|string} data - The data to compress.
 * @returns {Promise<Buffer>} A promise that resolves with the compressed data as a Buffer.
 */
async function compressData(data) {
  try {
    return new Promise((resolve, reject) => {
      zlib.gzip(data, (err, buffer) => {
        if (err) reject(err);
        else resolve(buffer);
      });
    });
  } catch (error) {
    log.error(`Error: ${error}`);
    process.exit(1);
  }
}

/**
 * Splits a buffer into chunks of a predefined size.
 *
 * @memberof sendChunkedMessage
 * @function splitIntoChunks
 * @param {Buffer} buffer - The buffer to split.
 * @returns {Promise<Buffer[]>} A promise that resolves with an array of buffer chunks.
 */
async function splitIntoChunks(buffer) {
  try {
    let chunks = [];
    for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
      chunks.push(buffer.slice(i, i + CHUNK_SIZE));
    }
    return chunks;
  } catch (error) {
    log.error(`Error: ${error}`);
    process.exit(1);
  }
}

/**
 * Sends a message in chunked form. Each chunk is compressed and sent sequentially.
 * The function handles creating and sending each chunk, and returns the result of the operation.
 *
 * @memberof sendChunkedMessage
 * @function sendChunkedMessage
 * @param {Object} params - Parameters for sending the chunked message.
 * @param {string} params.url - The base URL for the message exchange service.
 * @param {string} params.mailboxID - The sender's mailbox ID.
 * @param {string} params.mailboxPassword - The sender's mailbox password.
 * @param {string} params.sharedKey - The shared key for generating headers.
 * @param {string} params.mailboxTarget - The recipient's mailbox ID.
 * @param {Object} params.agent - The HTTPS agent for the request, handling SSL/TLS configurations and timeouts.
 * @param {Buffer} params.fileContent - The content of the file to send, as a Buffer.
 * @returns {Promise<Object>} A promise that resolves with the status and data of the send operation, or rejects with an error.
 */
async function sendChunkedMessage({
  url,
  mailboxID,
  mailboxPassword,
  sharedKey,
  mailboxTarget,
  agent,
  fileContent,
}) {
  try {
    let result = {
      status: null,
      data: null,
    };
    let messageID;
    let fullUrl;

    // Step 1: chunk the file
    const splitChunks = await splitIntoChunks(fileContent);

    // Step 2: Compress the chunks
    let chunks = [];
    for (let chunk of splitChunks) {
      let compressedChunk = await compressData(chunk);
      chunks.push(compressedChunk);
    }

    log.debug(`number of chunks: ${chunks.length}`);

    // Step 3: Send files over API
    for (let [index, data] of chunks.entries()) {
      // Setup headers, need a new one for each message due to nonce
      let headers = await generateHeaders({
        mailboxID: mailboxID,
        mailboxPassword: mailboxPassword,
        sharedKey: sharedKey,
      });
      headers["content-type"] = "application/octet-stream";
      headers["mex-from"] = mailboxID;
      headers["mex-to"] = mailboxTarget;
      headers["mex-workflowid"] = "API-DOCS-TEST";
      headers["mex-filename"] = "message.txt.gz";
      headers["mex-chunk-range"] = `${index + 1}:${chunks.length}`;
      headers["content-encoding"] = "gzip";
      let config = { headers: headers, httpsAgent: agent, setTimeout: 10000 };

      // First message will not have a message ID, subsequent ones will
      if (messageID) {
        fullUrl = `${url}/messageexchange/${mailboxID}/outbox/${messageID}/${
          index + 1
        }`;
      } else {
        fullUrl = `${url}/messageexchange/${mailboxID}/outbox`;
      }
      log.debug(`Chunk index: ${index}`);
      log.debug(`URL: ${fullUrl}\nheaders: ${JSON.stringify(config.headers)}`);
      let response = await axios.post(fullUrl, data, config);

      if (response.status === 202) {
        log.debug(response.data);
        if (response.data) {
          result.data = response.data;
          result.status = response.status;
        }
        log.debug(`${index + 1} Chunks sent successfully`);
        if (messageID) {
        } else {
          messageID = response.data["message_id"];
          response = response.data;
        }
      } else {
        console.error(
          "ERROR: Request 'sendMessageChunks' completed but responded with incorrect status: " +
            response.status
        );
        process.exit(1);
      }
    }
    return result;
  } catch (error) {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      log.error(
        `Request failed with status code ${error.response.status}: ${error.response.statusText}`
      );
      return error;
    } else if (error.request) {
      // The request was made but no response was received
      log.error("No response was received for the request");
      return error;
    } else {
      // Something happened in setting up the request that triggered an Error
      log.error("Error:", error.message);
      return error;
    }
  }
}

export default sendChunkedMessage;
