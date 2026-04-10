const whois = require('whois');

const domain = 'faker.com';

// Test 1: no options
whois.lookup(domain, (err, data) => {
  console.log('--- Test 1 (no options) ---');
  console.log('err:', err);
  console.log('data type:', typeof data);
  console.log('data length:', data?.length ?? 'null');
  console.log('data sample:', data?.slice(0, 300) ?? 'null');
});

// Test 2: with verbose
setTimeout(() => {
  whois.lookup(domain, { verbose: true, follow: 3, timeout: 15000 }, (err, data) => {
    console.log('\n--- Test 2 (verbose, follow:3) ---');
    console.log('err:', err);
    console.log('data is array:', Array.isArray(data));
    console.log('data type:', typeof data);
    if (Array.isArray(data)) {
      data.forEach((entry, i) => {
        console.log(`\nEntry ${i}: server=${entry.server}, data length=${entry.data?.length}`);
        console.log('sample:', entry.data?.slice(0, 200));
      });
    } else {
      console.log('data sample:', data?.slice(0, 300) ?? 'null');
    }
  });
}, 3000);
