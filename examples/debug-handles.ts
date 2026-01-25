import { ReaderClient } from "@vakra-dev/reader";

async function main() {
  console.log("Starting...");
  
  const reader = new ReaderClient({ verbose: true });

  try {
    const result = await reader.scrape({
      urls: ["https://example.com"],
      formats: ["markdown"],
    });
    console.log("Scrape done, title:", result.data[0]?.metadata.website.title);
  } finally {
    await reader.close();
  }
  
  console.log("After close, checking what keeps process alive...");
  
  // @ts-ignore
  const handles = process._getActiveHandles();
  // @ts-ignore  
  const requests = process._getActiveRequests();
  
  console.log("\nActive handles:", handles.length);
  handles.forEach((h: any, i: number) => {
    console.log("  " + i + ": " + h.constructor.name);
  });
  
  console.log("\nActive requests:", requests.length);
  
  setTimeout(() => {
    console.log("\nForce exiting...");
    process.exit(0);
  }, 2000);
}

main().catch(console.error);
