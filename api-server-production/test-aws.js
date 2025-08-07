const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

async function testAWSCredentials() {
  try {
    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'ap-southeast-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    console.log('Testing AWS credentials...');
    console.log('Region:', process.env.AWS_REGION);
    console.log('Bucket:', process.env.RESOURCE_BUCKET);
    console.log('Access Key ID:', process.env.AWS_ACCESS_KEY_ID?.substring(0, 10) + '...');

    const command = new ListBucketsCommand({});
    const response = await s3Client.send(command);

    console.log('✅ AWS credentials are working!');
    console.log('Available buckets:', response.Buckets?.map((b) => b.Name) || []);

    const targetBucket = process.env.RESOURCE_BUCKET;
    const bucketExists = response.Buckets?.some((b) => b.Name === targetBucket);

    if (bucketExists) {
      console.log(`✅ Bucket "${targetBucket}" exists and is accessible`);
    } else {
      console.log(`❌ Bucket "${targetBucket}" not found or not accessible`);
    }
  } catch (error) {
    console.error('❌ AWS credentials test failed:', error.message);
    console.error('Error details:', error);
  }
}

testAWSCredentials();
