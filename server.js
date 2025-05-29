
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'anime.html'));
});

app.get('/api/search-anime', async (req, res) => {
    const { animename, episode } = req.query;

    if (!animename || !episode) {
        return res.status(400).json({ message: 'Anime name and episode number are required' });
    }

    const externalApiUrl = `https://txtorg-anihx.hf.space/api/episode?anime=${encodeURIComponent(animename)}&ep=${encodeURIComponent(episode)}`;

    try {
        const apiResponse = await axios.get(externalApiUrl);
        const responseData = apiResponse.data;

        if (typeof responseData !== 'object' || responseData === null) {
            console.error('Unexpected response format from external API (not an object):', responseData);
            return res.status(500).json({ message: 'Received invalid data format from anime API.' });
        }
        
        if (responseData.detail && typeof responseData.detail === 'string' && (!responseData.title || !responseData.links)) {
            console.warn(`External API (200 OK) reported: ${responseData.detail} for ${animename} ep ${episode}`);
            return res.status(404).json({ message: responseData.detail });
        }

        const subLinksExist = responseData.links && responseData.links.sub && Object.keys(responseData.links.sub).length > 0;
        const dubLinksExist = responseData.links && responseData.links.dub && Object.keys(responseData.links.dub).length > 0;

        if (!responseData.title || !(subLinksExist || dubLinksExist)) {
            console.warn('Unexpected response structure from external API (200 OK, but critical data missing):', responseData);
            return res.status(404).json({ message: `Anime "${animename}" episode ${episode} not found or no download links available.` });
        }
        
        res.json(responseData);

    } catch (error) {
        console.error('Error in /api/search-anime proxy request:');
        if (error.response) {
            console.error('External API - Status:', error.response.status);
            console.error('External API - Data:', error.response.data);
            const message = error.response.data?.detail || `Error from external anime API: Status ${error.response.status}`;
            return res.status(error.response.status || 500).json({ message });
        } else if (error.request) {
            console.error('External API - No response received:', error.request);
            return res.status(503).json({ message: 'Service unavailable: No response from the external anime service.' });
        } else {
            console.error('Axios request setup error:', error.message);
            return res.status(500).json({ message: 'Internal server error: Failed to set up anime search request.' });
        }
    }
});

app.get('/api/image-proxy', async (req, res) => {
    const imageUrl = req.query.url;

    if (!imageUrl) {
        return res.status(400).send('Image URL is required');
    }

    try {
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer' 
        });

        const contentType = response.headers['content-type'];
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        } else {
            console.warn(`Content-Type missing for proxied image: ${imageUrl}. The browser might not render it correctly.`);
            // It's risky to set a default Content-Type if unknown.
            // Let the browser try to infer or fail.
        }
        res.send(response.data);
    } catch (error) {
        console.error(`Error proxying image ${imageUrl}:`);
        if (error.response) {
            console.error('External Image Source - Status:', error.response.status);
            // Avoid logging potentially large binary data for error.response.data
            // console.error('External Image Source - Data:', error.response.data); 
            return res.status(error.response.status || 500).send('Error fetching image from source via proxy.');
        } else if (error.request) {
            console.error('External Image Source - No response received for:', imageUrl);
            return res.status(503).send('Service unavailable: No response from image source via proxy.');
        } else {
            console.error('Axios request setup error for image proxy:', error.message);
            return res.status(500).send('Internal server error: Failed to set up image proxy request.');
        }
    }
});


app.listen(PORT, () => {
    console.log(`Express server is listening on http://localhost:${PORT}`);
    console.log(`Access the anime search page at: http://localhost:${PORT}/`);
    console.log(`API for anime search: http://localhost:${PORT}/api/search-anime?animename=youranimename&episode=yourepisode`);
    console.log(`Image proxy endpoint: http://localhost:${PORT}/api/image-proxy?url=imageurl`);
});
