// File Upload Service - Upload recordings to file.io (free hosting)
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

class FileUploadService {
    constructor() {
        console.log('📁 File Upload Service initialized (using catbox.moe)');
    }

    /**
     * Upload a file to catbox.moe
     * @param {string} filePath - Local path to the file
     * @param {string} fileName - Name for the file
     * @returns {object|null} - { url } or null on error
     */
    async uploadFile(filePath, fileName) {
        try {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                console.error('❌ File not found:', filePath);
                return null;
            }

            const stats = fs.statSync(filePath);
            console.log(`📤 Uploading ${fileName} (${Math.round(stats.size / 1024)}KB) to catbox.moe...`);

            const form = new FormData();
            form.append('reqtype', 'fileupload');
            form.append('fileToUpload', fs.createReadStream(filePath), fileName);

            const response = await axios.post('https://catbox.moe/user/api.php', form, {
                headers: form.getHeaders(),
                timeout: 300000, // 5 minute timeout for up to 200mb
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            console.log('📥 catbox.moe response:', response.data);

            if (response.data && response.data.startsWith('http')) {
                console.log(`✅ Uploaded successfully: ${response.data}`);
                return {
                    url: response.data
                };
            } else {
                console.error('❌ catbox.moe upload failed - response:', response.data);
                return null;
            }
        } catch (error) {
            console.error('❌ Upload error:', error.message);
            if (error.response) {
                console.error('   Response status:', error.response.status);
                console.error('   Response data:', error.response.data);
            }
            return null;
        }
    }
}

module.exports = new FileUploadService();
