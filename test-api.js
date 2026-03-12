const https = require('http');

https.get('http://localhost:3000/api/courses', (res) => {
  let data = '';
  res.on('data', (d) => {
    data += d;
  });
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      console.log(JSON.stringify(parsed.courses?.map(c => ({id: c.id, link: c.donation_link})).slice(0, 5), null, 2));
    } catch(e) {
      console.error(data.slice(0, 200));
    }
  });
}).on('error', (e) => {
  console.error(e);
});
