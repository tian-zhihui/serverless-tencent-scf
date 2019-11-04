'use strict';

const sinon           = require('sinon');
const RollbackService = require('./rollbackService');

describe('RollbackService@Library', () => {
    let rollbackService;
    let getCosObjectStub;
    let historyListStub;

    let options;

    beforeEach(() => {
        options = {
            region: 'ap-guangzhou',
        };
        rollbackService = new RollbackService('appid', 'secret_id', 'secret_key', options);

        getCosObjectStub = sinon.stub(rollbackService, 'getCosObject')
            .returns(Promise.resolve());
            
        historyListStub = sinon.stub(rollbackService, 'historyList')
            .returns(Promise.resolve());

    });

    afterEach(() => {
        rollbackService.historyList.restore();
        rollbackService.getCosObject.restore();
    });

    it('should make the rollback service accessible', () => {
        rollbackService.should.to.be.an.instanceof(RollbackService);
    });

    it('should run library get cos object function', () => rollbackService
        .getCosObject().then(()=>{
        getCosObjectStub.calledOnce.should.equal(true)
    }));

    it('should run library rollback service function', () => rollbackService
        .historyList().then(()=>{
        historyListStub.calledOnce.should.equal(true)
    }));
});