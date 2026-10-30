import { RedisClient, RedisString, RedisHash, RedisList, RedisSet, RedisSortedSet, RedisJson } from './index.js';

async function runExamples() {
    const redisClient = new RedisClient();
    await redisClient.connect();

    const redisString = new RedisString(redisClient.getClient());
    const redisHash = new RedisHash(redisClient.getClient());
    const redisList = new RedisList(redisClient.getClient());
    const redisSet = new RedisSet(redisClient.getClient());
    const redisSortedSet = new RedisSortedSet(redisClient.getClient());
    const redisJson = new RedisJson(redisClient.getClient());

    console.log('--- String Operations ---');
    await redisString.set('myString', 'Hello Redis');
    console.log('myString:', await redisString.get('myString'));
    await redisString.incr('myCounter');
    await redisString.incr('myCounter');
    console.log('myCounter:', await redisString.get('myCounter'));

    console.log('\n--- Hash Operations ---');
    await redisHash.hSet('myHash', 'field1', 'value1');
    await redisHash.hSet('myHash', 'field2', 'value2');
    console.log('myHash field1:', await redisHash.hGet('myHash', 'field1'));
    console.log('myHash all:', await redisHash.hGetAll('myHash'));

    console.log('\n--- List Operations ---');
    await redisList.rPush('myList', 'item1');
    await redisList.lPush('myList', 'item0');
    console.log('myList:', await redisList.lRange('myList', 0, -1));
    console.log('myList length:', await redisList.lLen('myList'));

    console.log('\n--- Set Operations ---');
    await redisSet.sAdd('mySet', 'member1');
    await redisSet.sAdd('mySet', 'member2');
    await redisSet.sAdd('mySet', 'member1'); // Duplicate, won't be added
    console.log('mySet members:', await redisSet.sMembers('mySet'));
    console.log('Is member1 in mySet?', await redisSet.sIsMember('mySet', 'member1'));

    console.log('\n--- Sorted Set Operations ---');
    await redisSortedSet.zAdd('mySortedSet', 1, 'memberA');
    await redisSortedSet.zAdd('mySortedSet', 3, 'memberC');
    await redisSortedSet.zAdd('mySortedSet', 2, 'memberB');
    console.log('mySortedSet members (0 to -1):', await redisSortedSet.zRange('mySortedSet', 0, -1));
    console.log('Score of memberB:', await redisSortedSet.zScore('mySortedSet', 'memberB'));

    console.log('\n--- JSON Operations (Nested Data) ---');
    const complexData = {
        name: 'John Doe',
        age: 30,
        address: {
            street: '123 Main St',
            city: 'Anytown',
            zip: '12345'
        },
        hobbies: ['reading', 'hiking', 'coding']
    };
    await redisJson.setJson('myComplexJson', complexData);
    console.log('myComplexJson:', await redisJson.getJson('myComplexJson'));

    await redisJson.updateJsonField('myComplexJson', 'address.city', 'Newtown');
    console.log('myComplexJson after update:', await redisJson.getJson('myComplexJson'));

    await redisJson.updateJsonField('myComplexJson', 'hobbies.0', 'swimming');
    console.log('myComplexJson after array update:', await redisJson.getJson('myComplexJson'));

    await redisJson.updateJsonField('myComplexJson', 'newField.nested', 'nestedValue');
    console.log('myComplexJson after adding new nested field:', await redisJson.getJson('myComplexJson'));

    // Clean up
    console.log('\n--- Cleaning up ---');
    await redisString.del('myString');
    await redisString.del('myCounter');
    await redisHash.del('myHash');
    await redisList.del('myList');
    await redisSet.del('mySet');
    await redisSortedSet.del('mySortedSet');
    await redisJson.deleteJson('myComplexJson');

    await redisClient.disconnect();
}

runExamples().catch(console.error);

