self.onmessage = async (e) => {
  const file = e.data;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    let binary = "";
    const chunkSize = 0x8000; 

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }

    const base64 = btoa(binary);

    self.postMessage({ success: true, base64 });
  } catch (err) {
    self.postMessage({ success: false, error: err.toString() });
  }
};
