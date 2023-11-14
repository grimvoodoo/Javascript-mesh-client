import axios from "axios";
import { Agent } from "https";
import { readFileSync, writeFile } from "fs";
import log from "loglevel";
import generateHeaders from "./generate_headers.js";

async function readMessage({
  url,
  mailboxID,
  mailboxPassword,
  sharedKey,
  messageID,
  tlsEnabled,
  agent,
}) {
  let chunkedMessage = "";
  let fullUrl = `${url}/messageexchange/${mailboxID}/inbox/${messageID}`;
  let headers = await generateHeaders(mailboxID, mailboxPassword, sharedKey);

  let config = { headers: headers };
  if (tlsEnabled) {
    config.httpsAgent = agent;
  }

  let response = await axios.get(fullUrl, config);

  try {
    if (response.status === 200) {
      // if the message is stand alone
      return response;
    } else if (response.status === 206) {
      log.debug("Message is chunked");
      // If the message is chunked then loop through all the chunks and return the assembled message
      do {
        chunkedMessage += response.data;
        const chunkRange = response.headers["mex-chunk-range"];
        const [currentChunk, totalChunks] = chunkRange.split(":").map(Number);
        log.debug(`chunk ${currentChunk} of ${totalChunks} downloaded`);
        if (currentChunk < totalChunks) {
          let headers = await generateHeaders(
            mailboxID,
            mailboxPassword,
            sharedKey
          );

          let config = { headers: headers };
          if (tlsEnabled) {
            config.httpsAgent = agent;
          }
          // If there are more chunks to fetch, update the URL for the next request
          fullUrl = `${url}/messageexchange/${mailboxID}/inbox/${messageID}/${
            currentChunk + 1
          }`;
          response = await axios.get(fullUrl, config);
        } else {
          break;
        }
      } while (true);

      return { status: 206, data: chunkedMessage };
    } else {
      console.error(
        "ERROR: Request 'getMessages' completed but responded with incorrect status: " +
          response.status
      );
      process.exit(1);
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

export default readMessage;
