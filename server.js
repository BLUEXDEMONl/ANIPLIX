
const express = require('express');
const axios = require('axios');
const path = require('path');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'anime.html'));
});

app.get('/random', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'random.html'));
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
        console.error(`Error in /api/search-anime proxy request for animename: ${animename}, episode: ${episode}:`);
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
        console.log(`Proxying image: ${imageUrl}`);
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
        });

        const contentType = response.headers['content-type'];
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        } else {
            console.warn(`Content-Type missing for proxied image: ${imageUrl}. Attempting to infer.`);
            if (imageUrl.endsWith('.jpg') || imageUrl.endsWith('.jpeg')) {
                res.setHeader('Content-Type', 'image/jpeg');
            } else if (imageUrl.endsWith('.png')) {
                res.setHeader('Content-Type', 'image/png');
            } else if (imageUrl.endsWith('.gif')) {
                res.setHeader('Content-Type', 'image/gif');
            } else {
                 console.warn(`Could not infer Content-Type for ${imageUrl}. Browser might not render it correctly.`);
            }
        }
        res.send(response.data);
    } catch (error) {
        console.error(`Error proxying image ${imageUrl}:`);
        if (error.response) {
            console.error('External Image Source - Status:', error.response.status);
            console.error('External Image Source - Data (first 100 chars):', String(error.response.data).substring(0,100));
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

app.get('/api/random-anime', async (req, res) => {
    const scrapeUrl = 'https://animeheaven.me/random.php';
    try {
        const response = await axios.get(scrapeUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
            maxRedirects: 5 
        });
        
        const finalUrl = response.request.res.responseUrl || scrapeUrl;
        let htmlData = response.data;

        // Check if the initial response is very short (likely a redirect page) or if it doesn't contain expected content,
        // and if the final URL is different from the initial scrape URL.
        if (response.data.length < 1000 && finalUrl !== scrapeUrl && !response.data.includes('infotitle c')) {
             console.log(`Initial fetch from random.php was short or a redirect page, attempting to fetch final URL: ${finalUrl}`);
             const finalResponse = await axios.get(finalUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
             });
             htmlData = finalResponse.data;
        }

        const $ = cheerio.load(htmlData);

        const englishName = $('div.infotitle.c').text().trim();
        const japaneseName = $('div.infotitlejp.c').text().trim() || 'Not available';
        const summary = $('div.infodes.c').text().trim();

        let poster = $('img.posterimg').attr('src');
        let fullPoster = '';

        if (poster) {
            fullPoster = poster.startsWith('http') ? poster : (poster.startsWith('/') ? `https://animeheaven.me${poster}` : `https://animeheaven.me/${poster}`);
        } else {
             // Fallback selector if 'img.posterimg' is not found
             poster = $('div.ani_detail_img_contain_bottom_left_img_out').find('img').attr('src') || $('meta[property="og:image"]').attr('content');
             if(poster){
                fullPoster = poster.startsWith('http') ? poster : (poster.startsWith('/') ? `https://animeheaven.me${poster}` : `https://animeheaven.me/${poster}`);
             }
        }
        
        const infoDivs = $('div.infoyear.c div.inline.c2');
        const episodes = $(infoDivs[0]).text().trim() || 'N/A';
        const year = $(infoDivs[1]).text().trim() || 'N/A';
        const rating = $(infoDivs[2]).text().trim() || 'N/A';

        const tags = [];
        $('div.infotags.c a div.boxitem').each((_, el) => {
            tags.push($(el).text().trim());
        });

        if (!englishName && !summary && !fullPoster) {
            console.error('Failed to scrape essential anime details from AnimeHeaven.', { finalUrl, htmlLength: htmlData.length });
            return res.status(500).json({ message: 'Failed to scrape anime details. The page structure might have changed or no details were found. Please try again.' });
        }

        res.json({
            englishName: englishName || "Title not found",
            japaneseName,
            summary: summary || "Summary not available.",
            poster: fullPoster,
            episodes,
            year,
            rating,
            tags
        });

    } catch (error) {
        console.error('Error in /api/random-anime endpoint:', error.message);
        if (error.response) {
             console.error('Error response data:', error.response.data ? String(error.response.data).substring(0, 200) + '...' : 'No response data');
             console.error('Error response status:', error.response.status);
        } else {
            console.error(error.stack)
        }
        res.status(500).json({ message: 'Server error while fetching random anime: ' + error.message });
    }
});


app.listen(PORT, () => {
    console.log(`Express server is listening on http://localhost:${PORT}`);
    console.log(`Access the anime search page at: http://localhost:${PORT}/`);
    console.log(`Access the random anime page at: http://localhost:${PORT}/random`);
    console.log(`API for anime search: http://localhost:${PORT}/api/search-anime?animename=youranimename&episode=yourepisode`);
    console.log(`Image proxy endpoint: http://localhost:${PORT}/api/image-proxy?url=imageurl`);
    console.log(`Random anime API: http://localhost:${PORT}/api/random-anime`);
});
    