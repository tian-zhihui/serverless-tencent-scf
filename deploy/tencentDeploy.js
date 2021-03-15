const BbPromise = require('bluebird')
const validate = require('../shared/validate')
const utils = require('../shared/utils')
const _ = require('lodash')
const tencentProvider = require('../provider/tencentProvider')
const DeployFunction = require('./lib/deployFunction')
const DeployTrigger = require('./lib/deployTrigger')
const MetricsFunction = require('../metrics/lib/displayMetrics')

class TencentDeploy {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options
    this.provider = this.serverless.getProvider('tencent')

    Object.assign(this, validate, utils, tencentProvider)

    this.hooks = {
      'before:deploy:deploy': () =>
        BbPromise.bind(this)
          .then(this.validate)
          .then(this.setDefaults),

      'deploy:deploy': () => BbPromise.bind(this).then(this.deploy)
    }
  }

  async deploy() {
    const provider = new tencentProvider(this.serverless, this.options)
    this.options = await provider.getUserCred(this.options)
    await provider.getUserAuth(this.options.credentials.tencent_owneruin)

    const services = this.provider.getServiceResource()
    const func = new DeployFunction(this.options, this.serverless)
    const trigger = new DeployTrigger(this.options, this.serverless)
    const MetricsHandler = new MetricsFunction(this.options, this.serverless)

    // upload file to cos
    const cosBucket = this.provider.getDeployCosBucket(true)
    this.serverless.cli.log(
      `Uploading service package to cos[${cosBucket}]. ${services.ServiceZipName}`
    )
    await func.uploadPackage2Cos(
      cosBucket,
      services.ServiceZipName,
      this.serverless.service.package.artifact
    )
    this.serverless.cli.log(
      `Uploaded package successful ${this.serverless.service.package.artifact}`
    )
    await func.uploadService2Cos(cosBucket, services.ServiceFileName, services)

    // deploy functions
    for (const funcName in services.Resources.default) {
      if (funcName == 'Type') {
        continue
      }
      const funcObject = _.cloneDeep(services.Resources.default[funcName])
      funcObject.Name = funcName
      funcObject.FuncName = this.provider.getFunctionName(funcName)
      funcObject.Namespace = provider.getFunctionNamespace(funcName)

      this.serverless.cli.log(`Creating function ${funcObject.Namespace}/${funcObject.FuncName}`)
      const oldFunc = await func.deploy(funcObject.Namespace, funcObject)
      this.serverless.cli.log(`Created function ${funcObject.Namespace}/${funcObject.FuncName}`)

      this.serverless.cli.log(
        `Setting tags for function ${funcObject.Namespace}/${funcObject.FuncName}`
      )
      await func.createTags(funcObject.Namespace, funcObject.FuncName, funcObject.Properties.Tags)

      if ((await func.checkStatus(funcObject.Namespace, funcObject)) == false) {
        throw `Function ${funcObject.Namespace}/${funcObject.FuncName} create/update failed`
      }

      this.serverless.cli.log(
        `Creating trigger for function ${funcObject.Namespace}/${funcObject.FuncName}`
      )
      await trigger.create(
        funcObject.Namespace,
        oldFunc ? oldFunc.Triggers : null,
        funcObject,
        (response, thisTrigger) => {
          if (thisTrigger.Type == 'apigw') {
            const resultDesc = JSON.parse(response.TriggerDesc)
            this.serverless.cli.log(
              `Created ${thisTrigger.Type} trigger ${response.TriggerName} for function ${funcObject.Namespace}/${funcObject.FuncName} success. service id ${resultDesc.service.serviceId} url ${resultDesc.service.subDomain}`
            )
          } else {
            this.serverless.cli.log(
              `Created ${thisTrigger.Type} trigger ${response.TriggerName} for function ${funcObject.Namespace}/${funcObject.FuncName} success.`
            )
          }
        },
        (error) => {
          this.serverless.cli.log(error)
        }
      )

      this.serverless.cli.log(
        `Deployed function ${funcObject.Namespace}/${funcObject.FuncName} successful`
      )
    }

    let outputInformation = `Service Information\nservice: ${this.serverless.service.service} \nstage: ${this.provider.options.stage} \nregion: ${this.provider.options.region} \nstack: ${this.serverless.service.service}-${this.provider.options.stage}\n`

    const functionList = await MetricsHandler.functionList(
      this.serverless.service.service,
      this.options.stage
    )
    const functionListData = functionList.Functions || []
    outputInformation =
      outputInformation + 'resources: ' + functionListData.length + '\nfunctions: '
    let functionInformation
    for (const funcName in services.Resources.default) {
      if (funcName == 'Type') {
        continue
      }
      if (this.options.function && this.options.function != funcName) {
        continue
      }
      const funcObject = _.cloneDeep(services.Resources.default[funcName])
      funcObject.Name = funcName
      funcObject.FuncName = this.provider.getFunctionName(funcName)
      funcObject.Namespace = provider.getFunctionNamespace(funcName)
      const deployFunctionName = this.provider.getFunctionName(funcName)
      outputInformation =
        outputInformation + `  ${funcObject.Namespace}/${funcName}: ${deployFunctionName}\n`
      functionInformation = await func.getFunction(funcObject.Namespace, deployFunctionName, false)
      if (functionInformation.Triggers && functionInformation.Triggers.length > 0) {
        for (let i = 0; i <= functionInformation.Triggers.length; i++) {
          if ((await func.checkStatus(funcObject.Namespace, funcObject)) == false) {
            throw `Function ${funcObject.Namespace}/${funcObject.FuncName} create/update failed`
          }
          const thisTrigger = functionInformation.Triggers[i]
          try {
            if (thisTrigger.Type == 'apigw') {
              const triggerDesc = JSON.parse(thisTrigger.TriggerDesc)
              outputInformation =
                outputInformation +
                `    ${triggerDesc.api.requestConfig.method} - ${triggerDesc.service.subDomain}\n`
            }
          } catch (e) {}
        }
      }
    }
    this.serverless.cli.log(outputInformation)
  }
}

module.exports = TencentDeploy
